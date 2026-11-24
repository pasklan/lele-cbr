import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectReader } from './windows-cdp.mjs';

assert.equal(process.platform, 'win32', 'Run using Windows Node.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(root, 'artifacts/package-check-v0.2.0/LeleCBR/LeitorLele.exe');
const selected = path.join(root, 'hqs/Spider-Gwen 01 (2015) (Marvel Knights SQ-MdHQ).cbr');
const { evaluate, until, pageReady, exceptions, close } = await connectReader();
try {
  await until('!document.querySelector(".library [role=status]")', 'empty library ready');
  assert.equal(await evaluate('document.querySelectorAll(".library-item").length'), 0);
  await evaluate('document.querySelector(".open-button").click()');
  const script = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class LelePackagePicker {
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c,string t);
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr p,int id);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,string l);
}
'@
$deadline=(Get-Date).AddSeconds(15)
do { $dialog=[LelePackagePicker]::FindWindow('#32770','Abrir quadrinho CBR'); if($dialog -eq [IntPtr]::Zero){Start-Sleep -Milliseconds 100} } while($dialog -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline)
if($dialog -eq [IntPtr]::Zero){throw 'Native picker not found'}
[uint32]$ownerId=0
[void][LelePackagePicker]::GetWindowThreadProcessId($dialog,[ref]$ownerId)
$ownerProcess=Get-Process -Id $ownerId
$expected='${executable.replaceAll("'", "''")}'
if($ownerProcess.MainModule.FileName -ne $expected){throw 'Refusing to operate on another application picker'}
$filename=[LelePackagePicker]::GetDlgItem($dialog,1148)
[void][LelePackagePicker]::SendMessage($filename,12,[IntPtr]::Zero,'${selected.replaceAll("'", "''")}')
[void][LelePackagePicker]::SendMessage([LelePackagePicker]::GetDlgItem($dialog,1),245,[IntPtr]::Zero,$null)
Write-Output ((Get-Item -LiteralPath $expected).VersionInfo.FileVersion)
`;
  const nativeOutput = execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 30_000, encoding: 'utf8' });
  assert.match(nativeOutput, /0\.2\.0/);
  await pageReady(1);
  assert.equal(await evaluate('Number(document.querySelector("[role=progressbar]").getAttribute("aria-valuemax"))'), 36);
  assert.equal(await evaluate('document.querySelectorAll("[role=alert]").length'), 0);
  assert.deepEqual(exceptions, []);
  const report = { extractedPackage: true, emptyBundledLibrary: true, nativeFilePicker: true, imageDecoded: true, pages: 36, fileVersion: nativeOutput.trim(), noJsExceptions: true };
  await writeFile(path.join(root, 'artifacts/windows-package-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { close(); }
