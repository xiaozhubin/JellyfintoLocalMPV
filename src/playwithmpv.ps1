param (
    [string]$InputUrl
)

# --- 配置 ---
# 1. MPV 可执行文件路径。如果 mpv.exe 在系统 PATH 环境变量中，可以直接用 "mpv"。
#    否则，请使用完整路径，例如: "C:\Program Files\mpv\mpv.exe" 或 "D:\tools\mpv\mpv.exe"
$mpvPath = "C:\Program Files\mpv\mpv.exe"
# $mpvPath = "C:\Users\YourUser\Desktop\mpv-x86_64-20240519-git-6996699\mpv.exe" # 示例：请修改为你的实际路径

# 2. 日志文件路径。确保此目录存在且 PowerShell 有写入权限。
$logFilePath = "C:\Temp\mpv_handler_log.txt" # 确保 C:\Temp 目录存在

# --- 函数：记录日志 ---
function Write-Log {
    param (
        [string]$Message
    )
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] $Message"
    try {
        Add-Content -Path $logFilePath -Value $logEntry -ErrorAction Stop
    }
    catch {
        Write-Warning "Failed to write to log file: $logFilePath. Error: $($_.Exception.Message)"
        Write-Host $logEntry # 如果日志文件写入失败，则输出到控制台
    }
}

# --- 主逻辑 ---
Write-Log "--- Script Start (v1.2) ---"
Write-Log "Received InputUrl: '$InputUrl'"

if (-not $InputUrl -or -not $InputUrl.StartsWith("mpv://")) {
    $errorMsg = "Invalid input URL. Expected format: mpv://VIDEO_URL. Received: '$InputUrl'"
    Write-Log "ERROR: $errorMsg"
    # Optional: Show a message box to the user
    # Add-Type -AssemblyName System.Windows.Forms
    # [System.Windows.Forms.MessageBox]::Show($errorMsg, "MPV Handler Error", "OK", "Error")
    exit 1
}

# 移除 "mpv://" 前缀
$videoUrlArgument = $InputUrl.Substring(6)
Write-Log "Extracted video URL argument (still encoded): '$videoUrlArgument'"

# URL 解码
try {
    $decodedVideoUrl = [System.Net.WebUtility]::UrlDecode($videoUrlArgument)
    Write-Log "Decoded Video URL: '$decodedVideoUrl'"
}
catch {
    $errorMsg = "Failed to URL decode the video link: '$videoUrlArgument'. Error: $($_.Exception.Message)"
    Write-Log "ERROR: $errorMsg"
    # Add-Type -AssemblyName System.Windows.Forms
    # [System.Windows.Forms.MessageBox]::Show($errorMsg, "MPV Handler Error", "OK", "Error")
    exit 1
}

# 检查 MPV 路径是否为 "mpv" 并且 MPV 是否真的在 PATH 中
if ($mpvPath -eq "mpv") {
    $mpvInPath = Get-Command mpv -ErrorAction SilentlyContinue
    if (-not $mpvInPath) {
        $errorMsg = "MPV path is set to 'mpv', but 'mpv' command was not found in PATH. Please set the full path to mpv.exe in the script."
        Write-Log "ERROR: $errorMsg"
        exit 1
    }
    Write-Log "MPV found in PATH: $($mpvInPath.Source)"
} else {
    # 如果设置了完整路径，检查文件是否存在
    if (-not (Test-Path $mpvPath -PathType Leaf)) {
        $errorMsg = "MPV executable not found at specified path: '$mpvPath'. Please check the path in the script."
        Write-Log "ERROR: $errorMsg"
        exit 1
    }
     Write-Log "Using specified MPV path: '$mpvPath'"
}

# 从解码后的 URL 中提取文件名作为标题
$videoFilename = ""
try {
    $videoFilename = Split-Path -Path $decodedVideoUrl -Leaf
    Write-Log "Extracted filename for title: '$videoFilename'"
}
catch {
    Write-Log "Warning: Could not extract filename from path '$decodedVideoUrl'. Title might be empty or use full path. Error: $($_.Exception.Message)"
    $videoFilename = $decodedVideoUrl # Fallback to full path if split fails
}

# MPV 启动参数
# PowerShell 会自动处理参数中的空格，当使用 @() 数组并将参数传递给 Start-Process -ArgumentList 时。
# 但为了确保 MPV 正确接收包含空格的路径和标题，我们将显式地为这些值添加引号，
# 通过在 PowerShell 字符串中使用三重引号 """value""" 或双重双引号 ""value"" 来实现。
# Start-Process -ArgumentList 会将数组中的每个元素作为单独的参数传递。

$mpvArgs = @(
    "--force-window",            # 强制创建播放窗口
    "--keep-open=yes",           # 播放结束后保持窗口打开 (直到手动关闭或按键)
    "--title=""$($videoFilename.Replace('"', '""'))""" # 设置窗口标题, 将文件名中的双引号转义为两个双引号
    # "--fs",                    # 以全屏模式启动
    # "--save-position-on-quit", # 退出时保存播放位置
    # "--ontop",                 # 窗口置顶
    # "--no-resume-playback",    # 禁用默认的断点续播
    """$decodedVideoUrl"""       # 将解码后的 URL (文件路径) 用引号括起来传递
)

$argumentListStringForLog = $mpvArgs -join ' ' # For logging purposes
Write-Log "Attempting to launch MPV. Executable: '$mpvPath'"
Write-Log "Arguments as passed to Start-Process (each element is a separate arg):"
$mpvArgs | ForEach-Object { Write-Log "  Arg: '$_'" }
Write-Log "Conceptual command line for logging: $mpvPath $argumentListStringForLog"


try {
    # 使用 -ArgumentList 将参数数组传递给 Start-Process，它会处理引用和空格
    # PowerShell 会确保每个参数（数组中的每个元素）被正确传递，包括那些包含空格的参数。
    Start-Process -FilePath $mpvPath -ArgumentList $mpvArgs -NoNewWindow:$false -ErrorAction Stop
    Write-Log "MPV launched successfully (or at least Start-Process command was issued without error)."
}
catch {
    $errorMsg = "Failed to start MPV. Executable: '$mpvPath'. Error: $($_.Exception.Message)"
    Write-Log "ERROR: $errorMsg"
    exit 1
}

Write-Log "--- Script End ---"
exit 0
