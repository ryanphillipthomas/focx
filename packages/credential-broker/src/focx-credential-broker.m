#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <libproc.h>
#import <pwd.h>
#import <signal.h>
#import <sys/socket.h>
#import <sys/stat.h>
#import <sys/sysctl.h>
#import <sys/un.h>
#import <unistd.h>

static NSString *const BrokerVersion = @"2";
static NSString *const BrokerSocketPath = @"/var/run/focx-credential-broker.sock";
static NSString *const KeychainPath = @"/Library/Keychains/System.keychain";
static NSString *const KeychainService = @"ai.focx.credential-broker";
static NSString *const GitHubAccount = @"github_focx_write_token";
static const NSUInteger MaxRequestBytes = 65536;
static const NSUInteger MaxResponseBytes = 2 * 1024 * 1024;
static volatile sig_atomic_t StopRequested = 0;
static NSMutableArray<NSMutableDictionary *> *RunGrants;

static void HandleSignal(int signalNumber) {
  (void)signalNumber;
  StopRequested = 1;
}

static BOOL IsUUID(NSString *value) {
  if (![value isKindOfClass:[NSString class]]) return NO;
  static NSRegularExpression *regex;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    regex = [NSRegularExpression regularExpressionWithPattern:
      @"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
      options:0 error:nil];
  });
  return [regex numberOfMatchesInString:value options:0 range:NSMakeRange(0, value.length)] == 1;
}

static NSString *EffectiveOrigin(NSString *raw, NSString **error) {
  NSURLComponents *parts = [NSURLComponents componentsWithString:raw ?: @""];
  if (!parts || ![parts.scheme.lowercaseString isEqualToString:@"https"] ||
      parts.host.length == 0 || parts.port == nil || parts.user.length ||
      parts.password.length || parts.query.length || parts.fragment.length ||
      (parts.path.length && ![parts.path isEqualToString:@"/"])) {
    if (error) *error = @"Paperclip origin must be exactly https://host:port with no path, userinfo, query, or fragment";
    return nil;
  }
  NSInteger port = parts.port.integerValue;
  if (port < 1 || port > 65535) {
    if (error) *error = @"Paperclip origin port is invalid";
    return nil;
  }
  return [NSString stringWithFormat:@"https://%@:%ld", parts.host.lowercaseString, (long)port];
}

static NSDictionary *JSONObject(NSData *body) {
  if (!body.length) return nil;
  id value = [NSJSONSerialization JSONObjectWithData:body options:0 error:nil];
  return [value isKindOfClass:[NSDictionary class]] ? value : nil;
}

static BOOL HasOnlyQueryItems(NSURLComponents *parts, NSSet<NSString *> *allowed) {
  for (NSURLQueryItem *item in parts.queryItems ?: @[]) {
    if (![allowed containsObject:item.name]) return NO;
    if ([item.name isEqualToString:@"order"] &&
        ![@[@"asc", @"desc"] containsObject:item.value ?: @""]) return NO;
    if ([item.name isEqualToString:@"after"] && !IsUUID(item.value ?: @"")) return NO;
  }
  return YES;
}

static NSString *ValidatePaperclipRequest(NSString *method, NSString *path,
                                           NSData *body, NSString *taskId,
                                           NSString *companyId) {
  NSSet *methods = [NSSet setWithArray:@[@"GET", @"POST", @"PATCH", @"PUT"]];
  if (![methods containsObject:method]) return @"method is not allowed";
  if (![path isKindOfClass:[NSString class]] || path.length == 0 || path.length > 2048 ||
      ![path hasPrefix:@"/"] || [path containsString:@"\\"] ||
      [path containsString:@"%"] || [path containsString:@"//"] ||
      [path containsString:@"#"] || [path containsString:@".."] ||
      [path containsString:@"://"]) return @"path is not a canonical relative API path";
  if (body.length > MaxRequestBytes) return @"request body exceeds 65536 bytes";
  if ([method isEqualToString:@"GET"] && body.length) return @"GET requests cannot carry a body";

  NSURLComponents *parts = [NSURLComponents componentsWithString:
    [@"https://broker.invalid" stringByAppendingString:path]];
  if (!parts || ![parts.host isEqualToString:@"broker.invalid"] || parts.fragment.length)
    return @"path could not be parsed safely";
  NSArray<NSString *> *segments = [parts.path componentsSeparatedByString:@"/"];
  if (segments.count < 4 || ![segments[0] isEqualToString:@""] ||
      ![segments[1] isEqualToString:@"api"]) return @"path is outside the API";

  BOOL allowed = NO;
  if (segments.count == 4 && [segments[2] isEqualToString:@"agents"] &&
      [segments[3] isEqualToString:@"me"] && [method isEqualToString:@"GET"]) {
    allowed = YES;
  }

  if (segments.count >= 4 && [segments[2] isEqualToString:@"issues"] &&
      [segments[3] isEqualToString:taskId]) {
    NSArray<NSString *> *tail = segments.count > 4
      ? [segments subarrayWithRange:NSMakeRange(4, segments.count - 4)] : @[];
    if (tail.count == 0)
      allowed = [@[@"GET", @"PATCH"] containsObject:method];
    else if (tail.count == 1 && [tail[0] isEqualToString:@"heartbeat-context"])
      allowed = [method isEqualToString:@"GET"];
    else if (tail.count == 1 && [tail[0] isEqualToString:@"comments"])
      allowed = [@[@"GET", @"POST"] containsObject:method];
    else if (tail.count == 2 && [tail[0] isEqualToString:@"comments"] && IsUUID(tail[1]))
      allowed = [method isEqualToString:@"GET"];
    else if (tail.count == 1 && [tail[0] isEqualToString:@"documents"])
      allowed = [method isEqualToString:@"GET"];
    else if (tail.count == 2 && [tail[0] isEqualToString:@"documents"] && tail[1].length <= 80)
      allowed = [@[@"GET", @"PUT"] containsObject:method];
    else if (tail.count == 1 && [tail[0] isEqualToString:@"interactions"])
      allowed = [@[@"GET", @"POST"] containsObject:method];
    else if (tail.count == 3 && [tail[0] isEqualToString:@"interactions"] &&
             IsUUID(tail[1]) && [@[@"accept", @"reject", @"respond", @"withdraw", @"verdicts"] containsObject:tail[2]])
      allowed = [method isEqualToString:@"POST"];
    else if (tail.count == 1 && [@[@"checkout", @"release"] containsObject:tail[0]])
      allowed = [method isEqualToString:@"POST"];
    else if (tail.count == 2 && [tail[0] isEqualToString:@"monitor"] && [tail[1] isEqualToString:@"check-now"])
      allowed = [method isEqualToString:@"POST"];
    else if (tail.count == 1 && [tail[0] isEqualToString:@"attachments"])
      allowed = [method isEqualToString:@"GET"];
  }

  NSDictionary *json = nil;
  if (body.length) {
    json = JSONObject(body);
    if (!json) return @"write body must be a JSON object";
  }
  if (segments.count == 5 && [segments[2] isEqualToString:@"companies"] &&
      [segments[3] isEqualToString:companyId] && [segments[4] isEqualToString:@"issues"] &&
      [method isEqualToString:@"POST"] && [json[@"parentId"] isEqualToString:taskId]) {
    allowed = YES;
  }
  if (segments.count == 5 && [segments[2] isEqualToString:@"companies"] &&
      [segments[3] isEqualToString:companyId] && [segments[4] isEqualToString:@"approvals"] &&
      [method isEqualToString:@"POST"] &&
      [json[@"issueIds"] isKindOfClass:[NSArray class]] && [json[@"issueIds"] count] == 1 &&
      [json[@"issueIds"][0] isEqualToString:taskId]) {
    allowed = YES;
  }
  if (!allowed) return @"path or method is outside the current task scope";

  NSSet *queryKeys = [NSSet setWithArray:@[@"after", @"order"]];
  if (parts.query.length &&
      !(segments.count >= 5 && [segments[2] isEqualToString:@"issues"] &&
        [segments[3] isEqualToString:taskId] && [segments[4] isEqualToString:@"comments"] &&
        [method isEqualToString:@"GET"] && HasOnlyQueryItems(parts, queryKeys))) {
    return @"query parameters are not allowed on this endpoint";
  }
  return nil;
}

static pid_t ParentPID(pid_t pid) {
  struct proc_bsdinfo info = {0};
  int got = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
  return got == sizeof(info) ? (pid_t)info.pbi_ppid : 0;
}

static NSString *ProcessPath(pid_t pid) {
  char path[PROC_PIDPATHINFO_MAXSIZE] = {0};
  int length = proc_pidpath(pid, path, sizeof(path));
  return length > 0 ? [NSString stringWithUTF8String:path] : nil;
}

static NSDictionary *ProcessInfo(pid_t pid) {
  struct proc_bsdinfo info = {0};
  int got = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
  if (got != sizeof(info)) return nil;
  return @{ @"pid": @(pid), @"uid": @(info.pbi_uid),
            @"startSeconds": @((unsigned long long)info.pbi_start_tvsec),
            @"startMicroseconds": @((unsigned long long)info.pbi_start_tvusec) };
}

static NSData *Base64URLDecode(NSString *value) {
  NSString *encoded = [[value stringByReplacingOccurrencesOfString:@"-" withString:@"+"]
    stringByReplacingOccurrencesOfString:@"_" withString:@"/"];
  NSUInteger padding = (4 - (encoded.length % 4)) % 4;
  encoded = [encoded stringByPaddingToLength:encoded.length + padding withString:@"=" startingAtIndex:0];
  return [[NSData alloc] initWithBase64EncodedString:encoded options:0];
}

static NSDictionary *JWTPayload(NSString *token) {
  NSArray<NSString *> *parts = [token componentsSeparatedByString:@"."];
  if (parts.count != 3) return nil;
  NSData *data = Base64URLDecode(parts[1]);
  id payload = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [payload isKindOfClass:[NSDictionary class]] ? payload : nil;
}

static NSString *ValidateRunGrant(NSDictionary *message, uid_t allowedUid) {
  NSSet *expected = [NSSet setWithArray:@[@"kind", @"pid", @"context", @"githubWrite"]];
  if (![expected isEqualToSet:[NSSet setWithArray:message.allKeys]]) return @"run registration contains unsupported fields";
  NSNumber *pidNumber = message[@"pid"], *githubWrite = message[@"githubWrite"];
  NSDictionary *context = message[@"context"];
  if (![pidNumber isKindOfClass:[NSNumber class]] || pidNumber.intValue <= 1 ||
      ![githubWrite isKindOfClass:[NSNumber class]] || ![context isKindOfClass:[NSDictionary class]])
    return @"run registration has invalid field types";
  NSSet *contextKeys = [NSSet setWithArray:@[@"PAPERCLIP_API_KEY", @"PAPERCLIP_TASK_ID",
    @"PAPERCLIP_RUN_ID", @"PAPERCLIP_COMPANY_ID", @"PAPERCLIP_AGENT_ID"]];
  if (![contextKeys isEqualToSet:[NSSet setWithArray:context.allKeys]]) return @"run context must contain only the five broker fields";
  for (NSString *key in contextKeys) if (![context[key] isKindOfClass:[NSString class]] || ![context[key] length])
    return @"run context has a missing value";
  if (!IsUUID(context[@"PAPERCLIP_TASK_ID"]) || !IsUUID(context[@"PAPERCLIP_RUN_ID"]) ||
      !IsUUID(context[@"PAPERCLIP_COMPANY_ID"]) || !IsUUID(context[@"PAPERCLIP_AGENT_ID"]))
    return @"run context identifiers must be UUIDs";
  NSDictionary *process = ProcessInfo(pidNumber.intValue);
  if (!process || [process[@"uid"] unsignedIntValue] != allowedUid) return @"registered process is absent or belongs to another uid";
  NSDictionary *claims = JWTPayload(context[@"PAPERCLIP_API_KEY"]);
  NSNumber *issuedAt = claims[@"iat"], *expiresAt = claims[@"exp"];
  NSTimeInterval now = NSDate.date.timeIntervalSince1970;
  if (![issuedAt isKindOfClass:[NSNumber class]] || ![expiresAt isKindOfClass:[NSNumber class]] ||
      ![claims[@"run_id"] isEqualToString:context[@"PAPERCLIP_RUN_ID"]] ||
      ![claims[@"company_id"] isEqualToString:context[@"PAPERCLIP_COMPANY_ID"]] ||
      ![claims[@"aud"] isEqualToString:@"paperclip-api"] ||
      expiresAt.doubleValue <= now || expiresAt.doubleValue - now > 4200 ||
      expiresAt.doubleValue - issuedAt.doubleValue > 4200 ||
      issuedAt.doubleValue > now + 60 || expiresAt.doubleValue <= issuedAt.doubleValue)
    return @"Paperclip JWT must match the run and expire within 70 minutes";
  return nil;
}

static NSDictionary *GrantForPeer(pid_t peerPID, NSString **error) {
  NSTimeInterval now = NSDate.date.timeIntervalSince1970;
  pid_t pid = peerPID;
  for (NSUInteger depth = 0; pid > 1 && depth < 48; depth++) {
    NSDictionary *process = ProcessInfo(pid);
    for (NSInteger i = (NSInteger)RunGrants.count - 1; i >= 0; i--) {
      NSDictionary *grant = RunGrants[(NSUInteger)i];
      if ([grant[@"expiresAt"] doubleValue] <= now) { [RunGrants removeObjectAtIndex:(NSUInteger)i]; continue; }
      if ([grant[@"pid"] intValue] == pid &&
          [grant[@"startSeconds"] isEqual:process[@"startSeconds"]] &&
          [grant[@"startMicroseconds"] isEqual:process[@"startMicroseconds"]]) return grant;
    }
    pid_t parent = ParentPID(pid);
    if (parent <= 1 || parent == pid) break;
    pid = parent;
  }
  if (error) *error = @"caller is not descended from a registered run";
  return nil;
}

static BOOL HasTrustedGitRemoteAncestor(pid_t peerPID, NSString *expectedPath) {
  pid_t pid = ParentPID(peerPID);
  for (NSUInteger depth = 0; pid > 1 && depth < 12; depth++) {
    if ([[ProcessPath(pid) stringByStandardizingPath] isEqualToString:[expectedPath stringByStandardizingPath]])
      return YES;
    pid_t parent = ParentPID(pid);
    if (parent <= 1 || parent == pid) break;
    pid = parent;
  }
  return NO;
}

static NSData *ReadKeychainSecret(NSString **error) {
  SecKeychainRef keychain = NULL;
  OSStatus status = SecKeychainOpen(KeychainPath.fileSystemRepresentation, &keychain);
  if (status != errSecSuccess) {
    if (error) *error = @"system Keychain is unavailable";
    return nil;
  }
  UInt32 length = 0;
  void *bytes = NULL;
  status = SecKeychainFindGenericPassword(keychain,
    (UInt32)KeychainService.length, KeychainService.UTF8String,
    (UInt32)GitHubAccount.length, GitHubAccount.UTF8String,
    &length, &bytes, NULL);
  NSData *result = status == errSecSuccess ? [NSData dataWithBytes:bytes length:length] : nil;
  if (bytes) SecKeychainItemFreeContent(NULL, bytes);
  CFRelease(keychain);
  if (!result && error) *error = @"GitHub credential is not installed in the system Keychain";
  return result;
}

static BOOL StoreKeychainSecret(NSData *value, NSString **error) {
  SecKeychainRef keychain = NULL;
  OSStatus status = SecKeychainOpen(KeychainPath.fileSystemRepresentation, &keychain);
  if (status != errSecSuccess) { if (error) *error = @"system Keychain is unavailable"; return NO; }
  SecKeychainItemRef item = NULL;
  status = SecKeychainFindGenericPassword(keychain,
    (UInt32)KeychainService.length, KeychainService.UTF8String,
    (UInt32)GitHubAccount.length, GitHubAccount.UTF8String,
    NULL, NULL, &item);
  if (status == errSecSuccess) {
    status = SecKeychainItemModifyAttributesAndData(item, NULL, (UInt32)value.length, value.bytes);
    CFRelease(item);
  } else if (status == errSecItemNotFound) {
    status = SecKeychainAddGenericPassword(keychain,
      (UInt32)KeychainService.length, KeychainService.UTF8String,
      (UInt32)GitHubAccount.length, GitHubAccount.UTF8String,
      (UInt32)value.length, value.bytes, NULL);
  }
  CFRelease(keychain);
  if (status != errSecSuccess && error) *error = @"could not write GitHub credential to the system Keychain";
  return status == errSecSuccess;
}

@interface FetchDelegate : NSObject <NSURLSessionDataDelegate, NSURLSessionTaskDelegate>
@property(nonatomic) dispatch_semaphore_t done;
@property(nonatomic) NSMutableData *data;
@property(nonatomic) NSHTTPURLResponse *response;
@property(nonatomic) NSError *error;
@property(nonatomic) BOOL exceeded;
@end

@implementation FetchDelegate
- (instancetype)init { if ((self = [super init])) { _done = dispatch_semaphore_create(0); _data = [NSMutableData data]; } return self; }
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
  willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request
  completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler {
  (void)session; (void)task; (void)response; (void)request; completionHandler(nil);
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask
  didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
  (void)session; (void)dataTask; self.response = (NSHTTPURLResponse *)response;
  completionHandler(NSURLSessionResponseAllow);
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data {
  (void)session;
  if (self.data.length + data.length > MaxResponseBytes) { self.exceeded = YES; [dataTask cancel]; return; }
  [self.data appendData:data];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  (void)session; (void)task; self.error = error; dispatch_semaphore_signal(self.done);
}
@end

static NSDictionary *PerformPaperclipRequest(NSDictionary *request, NSDictionary *context,
                                              NSString *origin) {
  NSString *method = request[@"method"], *path = request[@"path"];
  NSData *body = [request[@"body"] length]
    ? [request[@"body"] dataUsingEncoding:NSUTF8StringEncoding] : [NSData data];
  NSString *policyError = ValidatePaperclipRequest(method, path, body,
    context[@"PAPERCLIP_TASK_ID"], context[@"PAPERCLIP_COMPANY_ID"]);
  if (policyError) return @{ @"ok": @NO, @"error": policyError };

  NSURL *url = [NSURL URLWithString:[origin stringByAppendingString:path]];
  NSMutableURLRequest *outbound = [NSMutableURLRequest requestWithURL:url];
  outbound.HTTPMethod = method;
  outbound.timeoutInterval = 30;
  outbound.cachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
  [outbound setValue:[@"Bearer " stringByAppendingString:context[@"PAPERCLIP_API_KEY"]]
    forHTTPHeaderField:@"Authorization"];
  [outbound setValue:@"application/json" forHTTPHeaderField:@"Accept"];
  [outbound setValue:context[@"PAPERCLIP_RUN_ID"] forHTTPHeaderField:@"X-Paperclip-Run-Id"];
  if (body.length) {
    [outbound setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    outbound.HTTPBody = body;
  }

  NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
  configuration.HTTPCookieStorage = nil;
  configuration.URLCache = nil;
  configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
  configuration.connectionProxyDictionary = @{
    @"HTTPEnable": @NO, @"HTTPSEnable": @NO, @"SOCKSEnable": @NO,
    @"ProxyAutoConfigEnable": @NO, @"ProxyAutoDiscoveryEnable": @NO
  };
  FetchDelegate *delegate = [[FetchDelegate alloc] init];
  NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration delegate:delegate
    delegateQueue:[[NSOperationQueue alloc] init]];
  [[session dataTaskWithRequest:outbound] resume];
  dispatch_semaphore_wait(delegate.done, dispatch_time(DISPATCH_TIME_NOW, 35 * NSEC_PER_SEC));
  [session invalidateAndCancel];
  if (delegate.exceeded) return @{ @"ok": @NO, @"error": @"upstream response exceeds 2097152 bytes" };
  if (delegate.error || !delegate.response)
    return @{ @"ok": @NO, @"error": @"Paperclip request failed without exposing transport details" };
  NSString *responseBody = [[NSString alloc] initWithData:delegate.data encoding:NSUTF8StringEncoding];
  if (!responseBody) return @{ @"ok": @NO, @"error": @"Paperclip returned a non-UTF-8 response" };
  NSInteger status = delegate.response.statusCode;
  return @{ @"ok": @YES, @"status": @(status), @"body": responseBody };
}

static NSData *ReadBoundedFD(int fd, NSUInteger limit) {
  NSMutableData *data = [NSMutableData data];
  uint8_t buffer[4096];
  while (data.length <= limit) {
    ssize_t count = read(fd, buffer, sizeof(buffer));
    if (count <= 0) break;
    [data appendBytes:buffer length:(NSUInteger)count];
  }
  return data.length <= limit ? data : nil;
}

static BOOL WriteJSONFD(int fd, NSDictionary *object) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  if (!json) return NO;
  NSMutableData *framed = [json mutableCopy];
  uint8_t newline = '\n'; [framed appendBytes:&newline length:1];
  const uint8_t *cursor = framed.bytes;
  NSUInteger remaining = framed.length;
  while (remaining) {
    ssize_t count = write(fd, cursor, remaining);
    if (count <= 0) return NO;
    cursor += count; remaining -= (NSUInteger)count;
  }
  return YES;
}

static NSDictionary *ReadJSONFD(int fd, NSUInteger limit) {
  NSData *data = ReadBoundedFD(fd, limit);
  if (!data) return nil;
  id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [json isKindOfClass:[NSDictionary class]] ? json : nil;
}

static int PeerInfo(int fd, uid_t *uid, pid_t *pid) {
  gid_t gid = 0;
  if (getpeereid(fd, uid, &gid) != 0) return -1;
  socklen_t size = sizeof(*pid);
  return getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, pid, &size);
}

static NSDictionary *HandleBrokerMessage(NSDictionary *message, uid_t peerUid, pid_t peerPID,
                                          uid_t allowedUid, NSDictionary *config) {
  NSString *kind = message[@"kind"];
  if ([kind isEqualToString:@"doctor"]) {
    BOOL credentialReady = ReadKeychainSecret(NULL).length > 0;
    return @{ @"ok": @YES, @"version": BrokerVersion, @"origin": config[@"paperclipOrigin"],
              @"githubCredentialAvailable": @(credentialReady),
              @"privilegedRunRegistration": @YES,
              @"agentEnvironmentCredentialDiscovery": @NO };
  }
  if ([kind isEqualToString:@"register-run"]) {
    if (peerUid != 0) return @{ @"ok": @NO, @"error": @"run registration requires a root caller" };
    NSString *grantError = ValidateRunGrant(message, allowedUid);
    if (grantError) return @{ @"ok": @NO, @"error": grantError };
    NSDictionary *process = ProcessInfo([message[@"pid"] intValue]);
    NSDictionary *context = message[@"context"];
    NSDictionary *claims = JWTPayload(context[@"PAPERCLIP_API_KEY"]);
    for (NSInteger i = (NSInteger)RunGrants.count - 1; i >= 0; i--)
      if ([RunGrants[(NSUInteger)i][@"pid"] isEqual:message[@"pid"]]) [RunGrants removeObjectAtIndex:(NSUInteger)i];
    [RunGrants addObject:[@{ @"pid": message[@"pid"],
      @"startSeconds": process[@"startSeconds"], @"startMicroseconds": process[@"startMicroseconds"],
      @"context": context, @"githubWrite": message[@"githubWrite"], @"expiresAt": claims[@"exp"] } mutableCopy]];
    return @{ @"ok": @YES, @"runId": context[@"PAPERCLIP_RUN_ID"] };
  }
  if ([kind isEqualToString:@"revoke-run"]) {
    if (peerUid != 0) return @{ @"ok": @NO, @"error": @"run revocation requires a root caller" };
    NSString *runId = message[@"runId"];
    if (!IsUUID(runId)) return @{ @"ok": @NO, @"error": @"run id is invalid" };
    NSUInteger before = RunGrants.count;
    for (NSInteger i = (NSInteger)RunGrants.count - 1; i >= 0; i--)
      if ([RunGrants[(NSUInteger)i][@"context"][@"PAPERCLIP_RUN_ID"] isEqualToString:runId])
        [RunGrants removeObjectAtIndex:(NSUInteger)i];
    return @{ @"ok": @YES, @"revoked": @(before - RunGrants.count) };
  }
  if ([kind isEqualToString:@"paperclip"]) {
    if (![[NSSet setWithArray:@[@"kind", @"method", @"path", @"body"]] isEqualToSet:
          [NSSet setWithArray:message.allKeys]])
      return @{ @"ok": @NO, @"error": @"client request contains unsupported fields" };
    NSString *contextError = nil;
    NSDictionary *grant = GrantForPeer(peerPID, &contextError);
    if (!grant) return @{ @"ok": @NO, @"error": contextError };
    NSDictionary *context = grant[@"context"];
    return PerformPaperclipRequest(message, context, config[@"paperclipOrigin"]);
  }
  if ([kind isEqualToString:@"git-credential"]) {
    NSString *grantError = nil;
    NSDictionary *grant = GrantForPeer(peerPID, &grantError);
    if (!grant || ![grant[@"githubWrite"] boolValue])
      return @{ @"ok": @NO, @"error": grant ? @"run has no GitHub write grant" : grantError };
    if (!HasTrustedGitRemoteAncestor(peerPID, config[@"gitRemoteHelperPath"]))
      return @{ @"ok": @NO, @"error": @"Git credential request did not originate from the trusted HTTPS transport" };
    NSDictionary *input = message[@"input"];
    NSString *path = input[@"path"] ?: @"";
    NSString *expected = config[@"githubRepository"];
    BOOL repoMatches = [path isEqualToString:expected] || [path isEqualToString:[expected stringByAppendingString:@".git"]];
    if (![input[@"protocol"] isEqualToString:@"https"] ||
        ![input[@"host"] isEqualToString:@"github.com"] || !repoMatches)
      return @{ @"ok": @NO, @"error": @"Git credential request is outside the configured repository" };
    NSString *keychainError = nil;
    NSData *secret = ReadKeychainSecret(&keychainError);
    NSString *token = [[NSString alloc] initWithData:secret encoding:NSUTF8StringEncoding];
    if (!token.length) return @{ @"ok": @NO, @"error": keychainError ?: @"GitHub credential is unavailable" };
    return @{ @"ok": @YES, @"username": @"x-access-token", @"password": token };
  }
  return @{ @"ok": @NO, @"error": @"unknown broker request" };
}

static int ConnectToBroker(void) {
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return -1;
  struct sockaddr_un address = {0};
  address.sun_family = AF_UNIX;
  strlcpy(address.sun_path, BrokerSocketPath.fileSystemRepresentation, sizeof(address.sun_path));
  if (connect(fd, (struct sockaddr *)&address, SUN_LEN(&address)) != 0) { close(fd); return -1; }
  return fd;
}

static NSDictionary *CallBroker(NSDictionary *message) {
  int fd = ConnectToBroker();
  if (fd < 0) return @{ @"ok": @NO, @"error": @"credential broker is unavailable" };
  if (!WriteJSONFD(fd, message)) { close(fd); return @{ @"ok": @NO, @"error": @"credential broker write failed" }; }
  shutdown(fd, SHUT_WR);
  NSDictionary *response = ReadJSONFD(fd, MaxResponseBytes + 8192);
  close(fd);
  return response ?: @{ @"ok": @NO, @"error": @"credential broker returned an invalid response" };
}

static int RunPaperclipClient(int argc, const char *argv[]) {
  if (argc == 2 && strcmp(argv[1], "doctor") == 0) {
    NSDictionary *response = CallBroker(@{ @"kind": @"doctor" });
    NSData *json = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
    [[NSFileHandle fileHandleWithStandardOutput] writeData:json];
    fputc('\n', stdout);
    return [response[@"ok"] boolValue] ? 0 : 1;
  }
  if (argc != 3) {
    fputs("usage: paperclip METHOD /api/task-scoped-path\n", stderr); return 2;
  }
  NSString *method = [[NSString stringWithUTF8String:argv[1]] uppercaseString];
  NSString *path = [NSString stringWithUTF8String:argv[2]];
  NSData *body = [NSData data];
  if (![method isEqualToString:@"GET"] && !isatty(STDIN_FILENO)) {
    body = ReadBoundedFD(STDIN_FILENO, MaxRequestBytes);
    if (!body) { fputs("paperclip: request body exceeds 65536 bytes\n", stderr); return 2; }
  }
  NSString *bodyText = body.length ? [[NSString alloc] initWithData:body encoding:NSUTF8StringEncoding] : @"";
  if (!bodyText) { fputs("paperclip: body must be UTF-8 JSON\n", stderr); return 2; }
  NSDictionary *response = CallBroker(@{ @"kind": @"paperclip", @"method": method,
                                         @"path": path, @"body": bodyText });
  if (![response[@"ok"] boolValue]) {
    fprintf(stderr, "paperclip: %s\n", [response[@"error"] UTF8String]); return 1;
  }
  NSString *responseBody = response[@"body"] ?: @"";
  fwrite(responseBody.UTF8String, 1, [responseBody lengthOfBytesUsingEncoding:NSUTF8StringEncoding], stdout);
  if (![responseBody hasSuffix:@"\n"]) fputc('\n', stdout);
  NSInteger status = [response[@"status"] integerValue];
  return status >= 200 && status < 300 ? 0 : 22;
}

static NSDictionary *ParseGitCredentialInput(NSData *data) {
  NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  for (NSString *line in [text componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
    NSRange equals = [line rangeOfString:@"="];
    if (equals.location == NSNotFound) continue;
    NSString *key = [line substringToIndex:equals.location];
    if ([@[@"protocol", @"host", @"path"] containsObject:key])
      result[key] = [line substringFromIndex:equals.location + 1];
  }
  return result;
}

static int RunGitCredentialClient(int argc, const char *argv[]) {
  if (argc != 2) return 2;
  NSData *input = ReadBoundedFD(STDIN_FILENO, 8192);
  if (!input) return 1;
  NSString *operation = [NSString stringWithUTF8String:argv[1]];
  if (![operation isEqualToString:@"get"]) return 0;
  NSDictionary *response = CallBroker(@{ @"kind": @"git-credential", @"input": ParseGitCredentialInput(input) });
  if (![response[@"ok"] boolValue]) return 1;
  printf("username=%s\npassword=%s\n", [response[@"username"] UTF8String], [response[@"password"] UTF8String]);
  return 0;
}

static int RunServer(NSString *configPath) {
  if (geteuid() != 0) { fputs("broker server must run as root\n", stderr); return 2; }
  NSData *configData = [NSData dataWithContentsOfFile:configPath];
  NSDictionary *config = configData
    ? [NSJSONSerialization JSONObjectWithData:configData options:0 error:nil]
    : nil;
  NSString *originError = nil;
  NSString *origin = EffectiveOrigin(config[@"paperclipOrigin"], &originError);
  NSNumber *agentUid = config[@"agentUid"];
  if (!origin || ![config[@"socketPath"] isEqualToString:BrokerSocketPath] ||
      ![agentUid isKindOfClass:[NSNumber class]] || ![config[@"githubRepository"] length] ||
      ![config[@"gitRemoteHelperPath"] hasPrefix:@"/"]) {
    fprintf(stderr, "invalid broker config: %s\n", [originError ?: @"required field missing" UTF8String]); return 2;
  }
  NSMutableDictionary *effective = [config mutableCopy]; effective[@"paperclipOrigin"] = origin;
  uid_t allowedUid = (uid_t)agentUid.unsignedIntValue;
  struct passwd *pw = getpwuid(allowedUid);
  if (!pw) { fputs("configured agent uid does not exist\n", stderr); return 2; }

  unlink(BrokerSocketPath.fileSystemRepresentation);
  int listener = socket(AF_UNIX, SOCK_STREAM, 0);
  if (listener < 0) return 1;
  struct sockaddr_un address = {0}; address.sun_family = AF_UNIX;
  strlcpy(address.sun_path, BrokerSocketPath.fileSystemRepresentation, sizeof(address.sun_path));
  if (bind(listener, (struct sockaddr *)&address, SUN_LEN(&address)) != 0 || listen(listener, 32) != 0) {
    perror("broker socket"); close(listener); return 1;
  }
  chown(BrokerSocketPath.fileSystemRepresentation, 0, pw->pw_gid);
  chmod(BrokerSocketPath.fileSystemRepresentation, 0660);
  signal(SIGTERM, HandleSignal); signal(SIGINT, HandleSignal);
  RunGrants = [NSMutableArray array];
  while (!StopRequested) {
    int client = accept(listener, NULL, NULL);
    if (client < 0) { if (errno == EINTR) continue; break; }
    uid_t peerUid = 0; pid_t peerPID = 0;
    NSDictionary *response;
    if (PeerInfo(client, &peerUid, &peerPID) != 0 || (peerUid != allowedUid && peerUid != 0))
      response = @{ @"ok": @NO, @"error": @"caller uid is not authorized" };
    else {
      NSDictionary *message = ReadJSONFD(client, MaxRequestBytes + 8192);
      response = message ? HandleBrokerMessage(message, peerUid, peerPID, allowedUid, effective)
                         : @{ @"ok": @NO, @"error": @"invalid or oversized broker request" };
    }
    WriteJSONFD(client, response); close(client);
  }
  close(listener); unlink(BrokerSocketPath.fileSystemRepresentation); return 0;
}

static int RunRegisterCommand(pid_t pid) {
  if (geteuid() != 0 || pid <= 1) { fputs("register-run requires root and --pid PID\n", stderr); return 2; }
  NSData *input = ReadBoundedFD(STDIN_FILENO, MaxRequestBytes);
  NSDictionary *body = input ? JSONObject(input) : nil;
  if (!body) { fputs("register-run requires a JSON object on stdin\n", stderr); return 2; }
  NSDictionary *response = CallBroker(@{ @"kind": @"register-run", @"pid": @(pid),
    @"context": body[@"context"] ?: [NSNull null], @"githubWrite": body[@"githubWrite"] ?: [NSNull null] });
  if (![response[@"ok"] boolValue]) { fprintf(stderr, "%s\n", [response[@"error"] UTF8String]); return 1; }
  printf("registered run %s\n", [response[@"runId"] UTF8String]);
  return 0;
}

static int RunRevokeCommand(NSString *runId) {
  if (geteuid() != 0) { fputs("revoke-run requires root\n", stderr); return 2; }
  NSDictionary *response = CallBroker(@{ @"kind": @"revoke-run", @"runId": runId });
  if (![response[@"ok"] boolValue]) { fprintf(stderr, "%s\n", [response[@"error"] UTF8String]); return 1; }
  printf("revoked %ld grant(s)\n", (long)[response[@"revoked"] integerValue]);
  return 0;
}

static int StoreGitHubToken(void) {
  if (geteuid() != 0) { fputs("store-github-token must run as root\n", stderr); return 2; }
  NSData *input = ReadBoundedFD(STDIN_FILENO, 16384);
  NSString *token = [[[NSString alloc] initWithData:input encoding:NSUTF8StringEncoding]
    stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (token.length < 20) { fputs("refusing empty or implausibly short GitHub credential\n", stderr); return 2; }
  NSString *error = nil;
  if (!StoreKeychainSecret([token dataUsingEncoding:NSUTF8StringEncoding], &error)) {
    fprintf(stderr, "%s\n", error.UTF8String); return 1;
  }
  fputs("GitHub credential stored in the system Keychain\n", stdout); return 0;
}

static int SelfTest(void) {
  __block int passed = 0, failed = 0;
  NSString *task = @"145c42f6-2ccd-40e0-a341-ac88f6a43076";
  NSString *company = @"5f772ef2-25ce-466f-9392-027be5055470";
  void (^check)(BOOL, NSString *) = ^(BOOL condition, NSString *name) {
    if (condition) passed++; else { failed++; fprintf(stderr, "not ok - %s\n", name.UTF8String); }
  };
  NSString *originError = nil;
  check([[EffectiveOrigin(@"https://ops.focx.ai:443", &originError) description] isEqualToString:@"https://ops.focx.ai:443"], @"exact HTTPS origin accepted");
  check(EffectiveOrigin(@"http://ops.focx.ai:443", NULL) == nil, @"HTTP rejected");
  check(EffectiveOrigin(@"https://ops.focx.ai", NULL) == nil, @"implicit port rejected");
  check(EffectiveOrigin(@"https://ops.focx.ai:443/api", NULL) == nil, @"origin path rejected");
  NSData *empty = [NSData data];
  check(ValidatePaperclipRequest(@"GET", [@"/api/issues/" stringByAppendingString:task], empty, task, company) == nil, @"current issue read allowed");
  check(ValidatePaperclipRequest(@"PATCH", [@"/api/issues/" stringByAppendingString:task], [@"{}" dataUsingEncoding:NSUTF8StringEncoding], task, company) == nil, @"current issue patch allowed");
  check(ValidatePaperclipRequest(@"DELETE", [@"/api/issues/" stringByAppendingString:task], empty, task, company) != nil, @"DELETE rejected");
  check(ValidatePaperclipRequest(@"GET", @"/api/issues/81cdaaf5-d12d-407c-9d8e-213b6d2dd6da", empty, task, company) != nil, @"other task rejected");
  check(ValidatePaperclipRequest(@"GET", @"//evil.example/api/issues/x", empty, task, company) != nil, @"authority override rejected");
  check(ValidatePaperclipRequest(@"GET", [NSString stringWithFormat:@"/api/issues/%@/comments?order=asc", task], empty, task, company) == nil, @"bounded comments query allowed");
  check(ValidatePaperclipRequest(@"GET", [NSString stringWithFormat:@"/api/issues/%@/comments?redirect=https://evil.example", task], empty, task, company) != nil, @"unknown query rejected");
  NSData *child = [[NSString stringWithFormat:@"{\"parentId\":\"%@\"}", task] dataUsingEncoding:NSUTF8StringEncoding];
  check(ValidatePaperclipRequest(@"POST", [NSString stringWithFormat:@"/api/companies/%@/issues", company], child, task, company) == nil, @"current-task child creation allowed");
  check(ValidatePaperclipRequest(@"POST", [NSString stringWithFormat:@"/api/companies/%@/issues", company], [@"{}" dataUsingEncoding:NSUTF8StringEncoding], task, company) != nil, @"unscoped child creation rejected");
  NSMutableData *large = [NSMutableData dataWithLength:MaxRequestBytes + 1];
  check(ValidatePaperclipRequest(@"POST", [NSString stringWithFormat:@"/api/issues/%@/comments", task], large, task, company) != nil, @"oversized body rejected");
  NSTimeInterval now = NSDate.date.timeIntervalSince1970;
  NSDictionary *claims = @{ @"run_id": task, @"company_id": company, @"aud": @"paperclip-api",
    @"iat": @((long long)now), @"exp": @((long long)now + 3600) };
  NSData *claimsData = [NSJSONSerialization dataWithJSONObject:claims options:0 error:nil];
  NSString *payload = [[claimsData base64EncodedStringWithOptions:0] stringByReplacingOccurrencesOfString:@"=" withString:@""];
  payload = [[payload stringByReplacingOccurrencesOfString:@"+" withString:@"-"] stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
  NSDictionary *grantMessage = @{ @"kind": @"register-run", @"pid": @(getpid()), @"githubWrite": @YES,
    @"context": @{ @"PAPERCLIP_API_KEY": [NSString stringWithFormat:@"e30.%@.sig", payload],
      @"PAPERCLIP_TASK_ID": company, @"PAPERCLIP_RUN_ID": task, @"PAPERCLIP_COMPANY_ID": company,
      @"PAPERCLIP_AGENT_ID": company } };
  check(ValidateRunGrant(grantMessage, getuid()) == nil, @"short-lived run-matching registration accepted");
  NSDictionary *unprivileged = HandleBrokerMessage(grantMessage, getuid(), getpid(), getuid(), @{});
  check(![unprivileged[@"ok"] boolValue], @"agent uid cannot register its own run grant");
  NSMutableDictionary *longLived = [grantMessage mutableCopy];
  NSDictionary *longClaims = @{ @"run_id": task, @"company_id": company, @"aud": @"paperclip-api",
    @"iat": @((long long)now), @"exp": @((long long)now + 7200) };
  NSData *longData = [NSJSONSerialization dataWithJSONObject:longClaims options:0 error:nil];
  NSString *longPayload = [[longData base64EncodedStringWithOptions:0] stringByReplacingOccurrencesOfString:@"=" withString:@""];
  longPayload = [[longPayload stringByReplacingOccurrencesOfString:@"+" withString:@"-"] stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
  NSMutableDictionary *longContext = [grantMessage[@"context"] mutableCopy];
  longContext[@"PAPERCLIP_API_KEY"] = [NSString stringWithFormat:@"e30.%@.sig", longPayload];
  longLived[@"context"] = longContext;
  check(ValidateRunGrant(longLived, getuid()) != nil, @"long-lived run credential rejected");
  int pair[2] = {-1, -1}; uid_t peerUid = (uid_t)-1; pid_t peerPID = 0;
  BOOL peerReady = socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0 && PeerInfo(pair[0], &peerUid, &peerPID) == 0;
  check(peerReady && peerUid == getuid() && peerPID == getpid(), @"Unix peer uid and pid are kernel-derived");
  if (pair[0] >= 0) close(pair[0]); if (pair[1] >= 0) close(pair[1]);
  printf("credential-broker: %d passed, %d failed\n", passed, failed);
  return failed ? 1 : 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *program = [[[NSProcessInfo processInfo] arguments][0] lastPathComponent];
    if ([program isEqualToString:@"paperclip"]) return RunPaperclipClient(argc, argv);
    if ([program isEqualToString:@"git-credential-focx"]) return RunGitCredentialClient(argc, argv);
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) return SelfTest();
    if (argc == 2 && strcmp(argv[1], "store-github-token") == 0) return StoreGitHubToken();
    if (argc == 4 && strcmp(argv[1], "register-run") == 0 && strcmp(argv[2], "--pid") == 0)
      return RunRegisterCommand((pid_t)strtol(argv[3], NULL, 10));
    if (argc == 3 && strcmp(argv[1], "revoke-run") == 0)
      return RunRevokeCommand([NSString stringWithUTF8String:argv[2]]);
    if (argc == 4 && strcmp(argv[1], "server") == 0 && strcmp(argv[2], "--config") == 0)
      return RunServer([NSString stringWithUTF8String:argv[3]]);
    fputs("usage: focx-credential-broker server --config FILE | store-github-token | register-run --pid PID | revoke-run RUN_ID | --self-test\n", stderr);
    return 2;
  }
}
