# ASCII source intentionally: Windows PowerShell 5.1 also defaults script files to ANSI.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$temp = Join-Path $env:LOCALAPPDATA ('hermes/cache/scratch/connector-unicode-' + [guid]::NewGuid())
$keys = @('CRM_AI_TOKEN', 'CRM_BASE_URL', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key) }
try {
    New-Item -ItemType Directory -Path $temp | Out-Null
    $script:expectedName = 'Zo' + [char]0x00EB + ' Mu' + [char]0x00F1 + 'oz'
    $script:expectedBrief = 'Draping ' + [char]0x2014 + ' budget ' + [char]0x00A3 + '1,500'
    $candidate = @{ client_name = $script:expectedName; brief = $script:expectedBrief; status = 'New enquiry'; source_mailbox = 'info@quirky-hire.co.uk'; source_conversation_id = 'unicode-test' }
    $inputPath = Join-Path $temp 'candidates.json'
    [IO.File]::WriteAllText($inputPath, (ConvertTo-Json -InputObject @($candidate)), [Text.UTF8Encoding]::new($false))
    $env:CRM_AI_TOKEN = 'dummy-test-token-not-a-credential'
    $env:CRM_BASE_URL = 'https://connector.invalid'
    $env:CF_ACCESS_CLIENT_ID = $null
    $env:CF_ACCESS_CLIENT_SECRET = $null
    $script:posts = 0
    $script:reads = 0
    # Shadow both network cmdlets. No request or credential loader is used.
    function Invoke-WebRequest {
        param([switch]$UseBasicParsing, $Method, $Uri, $Headers, $ContentType, $Body, $MaximumRedirection, $TimeoutSec)
        if ($ContentType -notmatch '(?i)charset\s*=\s*utf-8') { throw 'Explicit UTF-8 HTTP charset is required to preserve Unicode on Windows PowerShell 5.1.' }
        $item = $Body | ConvertFrom-Json
        if ($item.client_name -cne $script:expectedName) { throw ('UTF-8 client name was corrupted before POST. actual=' + $item.client_name + '; expected=' + $script:expectedName) }
        if ($item.brief -cne $script:expectedBrief) { throw 'UTF-8 em dash/pound brief was corrupted before POST.' }
        if ($Uri -ne 'https://connector.invalid/api/ai/enquiries') { throw 'Unexpected test endpoint.' }
        $script:posts++
        $item | Add-Member -NotePropertyName id -NotePropertyValue 'unicode-local'
        $item | Add-Member -NotePropertyName reference -NotePropertyValue 'ENQ-TEST'
        $script:saved = $item
        return @{ StatusCode = 201; Content = ($item | ConvertTo-Json) }
    }
    function Invoke-RestMethod {
        param($Method, $Uri, $Headers, $MaximumRedirection, $TimeoutSec)
        if ($Uri -ne 'https://connector.invalid/api/ai/enquiries/unicode-local') { throw 'Unexpected read-back endpoint.' }
        $script:reads++
        return $script:saved
    }
    $outputPath = Join-Path $temp 'receipts.json'
    . (Join-Path $root 'scripts/enquiry_connector.ps1') -Action Ingest -InputFile $inputPath -OutputFile $outputPath -HermesHome $temp
    $receipt = @(Get-Content -Raw -Encoding UTF8 -LiteralPath $outputPath | ConvertFrom-Json)
    if ($script:posts -ne 1 -or $script:reads -ne 1 -or -not $receipt[0].verified -or $receipt[0].client_name -cne $script:expectedName) { throw 'Unicode receipt/read-back regression.' }
    Write-Output ('PASS: PowerShell ' + $PSVersionTable.PSVersion + ' UTF-8-no-BOM name, em dash and pound preserved; 1 mocked POST + 1 mocked read-back; no network.')
} finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key]) }
    Remove-Item -Recurse -Force -LiteralPath $temp
}
