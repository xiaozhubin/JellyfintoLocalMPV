# JellyfintoLocalMPV
一个将 Jellyfin 网页端的播放按钮功能改为调用本地mpv播放器的脚本。

注：所有代码由 Gemini 生成。

## 使用方法
1. 下载 `playwithmpv.ps1` 和 `mpv_protocol.reg`。建议 `playwithmpv.ps1` 放在 MPV 文件夹里。
2. 修改 `playwithmpv.ps1` 中 MPV 的路径。
3. 修改 `mpv_protocol.reg` 中的 playwithmpv.ps1 的路径。
4. 双击 `mpv_protocol.reg` 注册。
5. 将 `` 中的脚本复制到油猴脚本中。



> 如果ps1脚本无法运行，可能是windows策略有问题，请按以下方法解决。
> 1. 以管理员身份打开 PowerShell。
> 2. 输入 `Set-ExecutionPolicy RemoteSigned` 或 `Set-ExecutionPolicy Unrestricted`。按 Y 确认。
> 注意： Unrestricted 风险较高。RemoteSigned 通常足够，它允许本地脚本运行，但要求下载的脚本有签名。了解这些策略的含义再做选择。
