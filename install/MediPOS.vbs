' MediPOS launcher for Windows.
'
' Double-clicking this (or the desktop shortcut that points at it) starts the
' till if it is not already running and opens it in its own window — no console
' window, no address bar, no terminal for shop staff to close by accident.
'
' A .vbs is used rather than a .bat because Windows shows a black console
' window for a .bat, and staff invariably close it and wonder why the till died.

Option Explicit

Dim fso, sh, appDir, port, url, i, nodeExe, bundled, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
port   = 4173
url    = "http://localhost:" & port

' A Node runtime bundled into runtime\win-x64 is preferred over anything
' installed on this computer, so the shop needs no install and no internet.
' Chr(34) is a double quote — clearer than escaping quotes inside quotes.
nodeExe = appDir & "\runtime\win-x64\node.exe"
bundled = fso.FileExists(nodeExe)
If bundled Then
  command = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & appDir & "\server\index.mjs" & Chr(34)
Else
  command = "node " & Chr(34) & appDir & "\server\index.mjs" & Chr(34)
End If

' Already running? Then just bring up the window — starting a second copy would
' only exit with "port already in use" anyway.
If Not ServerUp() Then
  On Error Resume Next
  sh.CurrentDirectory = appDir
  sh.Run command, 0, False
  If Err.Number <> 0 Then
    On Error GoTo 0
    If bundled Then
      MsgBox "MediPOS could not start its own copy of Node." & vbCrLf & vbCrLf & _
             "Antivirus may have blocked or removed this file:" & vbCrLf & nodeExe, 48, "MediPOS"
    Else
      MsgBox "MediPOS needs Node.js, which does not seem to be installed." & vbCrLf & vbCrLf & _
             "Install it once from https://nodejs.org (choose the LTS version)," & vbCrLf & _
             "then open MediPOS again.", 48, "MediPOS"
    End If
    WScript.Quit 1
  End If
  On Error GoTo 0

  ' Give it up to 30 seconds — the very first start also seeds the demo shop.
  For i = 1 To 60
    WScript.Sleep 500
    If ServerUp() Then Exit For
  Next
End If

If Not ServerUp() Then
  MsgBox "MediPOS did not start." & vbCrLf & vbCrLf & _
         "Try restarting the computer. If it still will not open, the shop's" & vbCrLf & _
         "records are safe in:" & vbCrLf & appDir & "\server\data", 16, "MediPOS"
  WScript.Quit 1
End If

OpenWindow
WScript.Quit 0

' --------------------------------------------------------------------------

Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", url & "/api/health", False
  http.Send
  If Err.Number = 0 Then ServerUp = (http.Status = 200)
  On Error GoTo 0
End Function

' Opens in app mode so the till fills the screen with no tabs or address bar.
Sub OpenWindow()
  Dim candidates, path
  candidates = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"), _
    sh.ExpandEnvironmentStrings("%LocalAppData%\Google\Chrome\Application\chrome.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"))

  For Each path In candidates
    If fso.FileExists(path) Then
      sh.Run """" & path & """ --app=" & url & " --start-maximized", 1, False
      Exit Sub
    End If
  Next

  ' No Chrome or Edge — fall back to whatever opens links.
  sh.Run url, 1, False
End Sub
