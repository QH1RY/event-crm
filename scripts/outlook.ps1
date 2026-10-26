# Run under PowerShell 7. Microsoft Graph SDK owns authentication and token storage.
[CmdletBinding()]
param(
 [ValidateSet('Status','Connect','Disconnect','Calendar','Inbox','Draft','SyncBooking')]
 [string]$Action = 'Status',
 [string]$InputFile,
 [string]$BookingId,
 [string]$From,
 [string]$To,
 [string]$Account = $env:OUTLOOK_ACCOUNT,
 [string]$ClientId = $env:OUTLOOK_CLIENT_ID,
 [string]$TenantId = $env:OUTLOOK_TENANT_ID,
 [string]$CrmUrl = $env:CRM_BASE_URL
)
$ErrorActionPreference = 'Stop'
function Result($value) { $value | ConvertTo-Json -Depth 30 }
$module = Get-Module -ListAvailable Microsoft.Graph.Authentication | Select-Object -First 1
if ($Action -eq 'Status' -and -not $module) {
 Result @{ready=$false;reason='Microsoft.Graph.Authentication is not installed';next='Install-Module Microsoft.Graph.Authentication -Scope CurrentUser -Repository PSGallery'}
 return
}
if (-not $module) { throw 'Install Microsoft.Graph.Authentication from PSGallery first. See docs/PA-INTEGRATION.md.' }
Import-Module Microsoft.Graph.Authentication
if ($Action -eq 'Connect') {
 if (-not $Account) { throw 'Set OUTLOOK_ACCOUNT to the intended mailbox before signing in.' }
 $options = @{Scopes=@('User.Read','Calendars.ReadWrite','Mail.ReadWrite');ContextScope='CurrentUser';NoWelcome=$true}
 if ($ClientId) { $options.ClientId=$ClientId }
 if ($TenantId) { $options.TenantId=$TenantId }
 Connect-MgGraph @options
}
if ($Action -eq 'Disconnect') { Disconnect-MgGraph | Out-Null; Result @{connected=$false}; return }
$context = Get-MgContext
if ($Action -eq 'Status') {
 Result @{ready=([bool]$context -and [bool]$Account -and $context.Account -ieq $Account);account=$context.Account;expected_account=$Account;scopes=$context.Scopes}
 return
}
if (-not $context -or -not $Account -or $context.Account -ine $Account) { throw 'No matching Outlook sign-in. Set OUTLOOK_ACCOUNT and run -Action Connect.' }
foreach ($scope in @('User.Read','Calendars.ReadWrite','Mail.ReadWrite')) {
 if ($scope -notin $context.Scopes) { throw "Missing permission $scope. Run -Action Connect again." }
}
function Graph([string]$Method,[string]$Path,$Body=$null) {
 # Only fixed, internal paths call this function. No arbitrary URL comes from input.
 $opts=@{Method=$Method;Uri="https://graph.microsoft.com/v1.0$Path";OutputType='Hashtable'}
 if ($null -ne $Body) {$opts.Body=($Body|ConvertTo-Json -Depth 30 -Compress);$opts.ContentType='application/json'}
 Invoke-MgGraphRequest @opts
}
function Pages([string]$Path) {
 $items=@()
 do {
  $page=Graph GET $Path
  $items+=@($page.value)
  $next=$page.'@odata.nextLink'
  if ($next) {
   if (-not $next.StartsWith('https://graph.microsoft.com/v1.0/')) {throw 'Unexpected Graph pagination origin'}
   $Path=$next.Substring('https://graph.microsoft.com/v1.0'.Length)
  }
 } while ($next)
 return ,$items
}
function CalendarRange([string]$Start,[string]$End) {
 # Require explicit offsets; host timezone must not change the requested window.
 if ($Start -notmatch '(Z|[+-]\d{2}:\d{2})$' -or $End -notmatch '(Z|[+-]\d{2}:\d{2})$') {throw 'Calendar bounds require ISO timestamps with Z or a timezone offset.'}
 if ([datetimeoffset]$End -le [datetimeoffset]$Start) {throw 'Calendar end must be after start.'}
 $a=[uri]::EscapeDataString($Start);$b=[uri]::EscapeDataString($End)
 Pages "/me/calendarView?startDateTime=$a&endDateTime=$b&`$select=id,subject,start,end,showAs,isCancelled,webLink&`$top=100"
}
function Crm([string]$Method,[string]$Path,$Body=$null) {
 if (-not $CrmUrl -or -not $env:CRM_AI_TOKEN) {throw 'Set CRM_BASE_URL and CRM_AI_TOKEN in the host secret configuration.'}
 $uri=[uri]$CrmUrl
 if ($uri.Scheme -ne 'https' -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') {throw 'CRM_BASE_URL must be an HTTPS origin without a path or query.'}
 $headers=@{Authorization="Bearer $env:CRM_AI_TOKEN"}
 if ($env:CF_ACCESS_CLIENT_ID -and $env:CF_ACCESS_CLIENT_SECRET) {
  $headers['CF-Access-Client-Id']=$env:CF_ACCESS_CLIENT_ID
  $headers['CF-Access-Client-Secret']=$env:CF_ACCESS_CLIENT_SECRET
 }
 $opts=@{Method=$Method;Uri=($CrmUrl.TrimEnd('/')+$Path);Headers=$headers}
 if ($null -ne $Body) {$opts.Body=($Body|ConvertTo-Json -Depth 20 -Compress);$opts.ContentType='application/json'}
 Invoke-RestMethod @opts
}
switch ($Action) {
 'Connect' { Result @{connected=$true;account=$context.Account} }
 'Calendar' { Result @{items=@(CalendarRange $From $To)} }
 'Inbox' { Result (Graph GET '/me/mailFolders/inbox/messages?$select=id,subject,from,receivedDateTime,isRead,webLink,bodyPreview&$orderby=receivedDateTime desc&$top=25') }
 'Draft' {
  if (-not $InputFile) {throw 'Supply -InputFile with to, subject and body fields.'}
  $draft=Get-Content -LiteralPath $InputFile -Raw|ConvertFrom-Json
  if (-not $draft.to -or -not $draft.subject -or -not $draft.body) {throw 'to, subject and body are required'}
  $recipients=@($draft.to)|ForEach-Object {
   $address=[string]$_
   if ($address -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {throw 'Invalid recipient address'}
   @{emailAddress=@{address=$address}}
  }
  $saved=Graph POST '/me/messages' @{subject=[string]$draft.subject;body=@{contentType='Text';content=[string]$draft.body};toRecipients=@($recipients)}
  Result @{draft_id=$saved.id;webLink=$saved.webLink;sent=$false}
 }
 'SyncBooking' {
  if (-not $BookingId) {throw 'Supply -BookingId'}
  $id=[uri]::EscapeDataString($BookingId)
  $booking=Crm GET "/api/ai/bookings/$id"
  if (-not $booking.version) {throw 'CRM concurrency migration is not deployed'}
  if ($booking.event_date -notmatch '^\d{4}-\d{2}-\d{2}$' -or $booking.event_start -notmatch '^\d{2}:\d{2}(:\d{2})?$' -or $booking.event_end -notmatch '^\d{2}:\d{2}(:\d{2})?$') {
   throw 'Set the event date, start time and end time in the CRM before creating a calendar entry.'
  }
  $start=[datetime]::ParseExact(($booking.event_date+' '+$booking.event_start.Substring(0,5)),'yyyy-MM-dd HH:mm',[cultureinfo]::InvariantCulture)
  $end=[datetime]::ParseExact(($booking.event_date+' '+$booking.event_end.Substring(0,5)),'yyyy-MM-dd HH:mm',[cultureinfo]::InvariantCulture)
  if ($end -le $start) {throw 'Overnight or zero-length events need explicit handling. No calendar change was made.'}
  $zone=[TimeZoneInfo]::FindSystemTimeZoneById('GMT Standard Time')
  if ($zone.IsInvalidTime($start) -or $zone.IsAmbiguousTime($start) -or $zone.IsInvalidTime($end) -or $zone.IsAmbiguousTime($end)) {throw 'The event falls on an ambiguous daylight-saving time. Resolve it before syncing.'}
  $startUtc=[TimeZoneInfo]::ConvertTimeToUtc($start,$zone).ToString("yyyy-MM-ddTHH:mm:ss'Z'")
  $endUtc=[TimeZoneInfo]::ConvertTimeToUtc($end,$zone).ToString("yyyy-MM-ddTHH:mm:ss'Z'")
  $conflicts=@(CalendarRange $startUtc $endUtc)|Where-Object { -not $_.isCancelled -and $_.showAs -ne 'free' -and $_.id -ne $booking.outlook_event_id }
  if ($conflicts.Count) {throw 'Calendar conflict found. Review availability before syncing this booking.'}
  $link=$CrmUrl.TrimEnd('/')+'/bookings/'+$id
  $payload=@{
   subject=($booking.reference+' | '+$booking.event_name)
   start=@{dateTime=$start.ToString('yyyy-MM-ddTHH:mm:ss');timeZone='GMT Standard Time'}
   end=@{dateTime=$end.ToString('yyyy-MM-ddTHH:mm:ss');timeZone='GMT Standard Time'}
   location=@{displayName=[string]$booking.venue}
   body=@{contentType='Text';content=("CRM booking: "+$link+"`nClient: "+$booking.client_name)}
   isReminderOn=$true;reminderMinutesBeforeStart=60
  }
  if ($booking.outlook_event_id) {
   $eventId=[uri]::EscapeDataString($booking.outlook_event_id)
   $existing=Graph GET "/me/events/$eventId`?`$select=id,attendees"
   if (@($existing.attendees).Count) {throw 'This calendar entry has attendees. Review it in Outlook before changing it.'}
   $saved=Graph PATCH "/me/events/$eventId" $payload
  } else {
   # The same booking reuses its transaction ID if the Graph response is lost.
   $payload.transactionId='event-crm-'+$BookingId
   $saved=Graph POST '/me/events' $payload
  }
  try {
   $null=Crm PATCH "/api/ai/bookings/$id" @{version=$booking.version;outlook_event_id=$saved.id;outlook_event_url=$saved.webLink}
  } catch {
   # Preserve the Graph ID so an operator can reconcile rather than blindly recreate.
   Result @{synced=$false;reconciliation_required=$true;booking_id=$BookingId;outlook_event_id=$saved.id;outlook_event_url=$saved.webLink}
   throw 'Outlook saved the entry but the CRM link could not be saved. Reconcile the returned event ID before retrying.'
  }
  Result @{synced=$true;booking_id=$BookingId;outlook_event_id=$saved.id;outlook_event_url=$saved.webLink}
 }
}
