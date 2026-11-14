# Creates a self-signed code-signing certificate so installers show "Iqbal Uddin Khan" as the publisher
# on YOUR computers. Other people's PCs will still say "Unknown publisher" until you use a certificate
# issued by a public certificate authority (see docs/RELEASING.md).
# Run in an elevated PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\windows\make-signing-cert.ps1
$subject = "CN=Iqbal Uddin Khan"
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -KeyAlgorithm RSA -KeyLength 3072 `
        -KeyUsage DigitalSignature -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(3)
$pwd = Read-Host -AsSecureString "Choose a password for the .pfx file"
Export-PfxCertificate -Cert $cert -FilePath "$PWD\iqbal-code-signing.pfx" -Password $pwd | Out-Null
Export-Certificate    -Cert $cert -FilePath "$PWD\iqbal-code-signing.cer" | Out-Null
# Trust it on this PC (installer will then show the publisher name and no SmartScreen warning here)
Import-Certificate -FilePath "$PWD\iqbal-code-signing.cer" -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Import-Certificate -FilePath "$PWD\iqbal-code-signing.cer" -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
Write-Host "Created iqbal-code-signing.pfx (keep it private, never commit it) and iqbal-code-signing.cer"
Write-Host 'To sign a build:  $env:CSC_LINK="$PWD\iqbal-code-signing.pfx"; $env:CSC_KEY_PASSWORD="<password>"; npm run dist:win'
