# PR Title
feat(xmuoj-vscode): improve problemset workbench UX, contest-target actions, and progress scoping

# Summary
This PR focuses on xmuoj-vscode usability and correctness improvements for daily problem-solving workflow.

Key updates included:

1. Public problemset workbench UX optimization
- Converted result and queue rendering to compact table layout.
- Moved action buttons to the left for faster operation while reading title/content.
- Reduced action control font size and spacing so more controls fit in one board.

2. Toolbar icon refresh
- Replaced toolbar icons with cleaner line-style visuals for login/open/search/refresh/workspace actions.

3. Multi-contest action correctness fix
- Fixed issue where clicking "batch create problem directories" under another contest still executed against the first contest.
- Contest-scoped actions now carry explicit entry payload and run against clicked contest.

4. Contest-target safety improvements
- Added explicit contest name into contest action descriptions.
- Added confirmation dialog before batch directory creation, showing exact target contest.
- Synced active contest context on contest-scoped actions to reduce mis-operations.
- Added visible active contest marker in contest list for quick identification.

5. Progress status scoping fix
- Fixed stale AC status leakage across different local working folders.
- Problem progress key now includes local workspace scope (xmuoj.localWorkspaceRoot fallback workspace folder).
- Tree status lookup aligned with scoped progress key logic.

6. Cleanup of redundant menu item
- Removed redundant "remove public problemset item" context menu entry from explorer item menu.

# User-visible Behavior Changes
- Problemset workbench operations are denser and faster to click.
- Contest actions under each contest entry now reliably target that specific contest.
- Batch create now clearly confirms which contest will be processed.
- Active contest is visually highlighted in the list.
- Problem status (AC/started/submitted) no longer incorrectly carries over between different local roots.

# Validation Performed
- Syntax and diagnostics checks passed for updated files.
- Extension packaged successfully via npm run package.
- VSIX artifact generated: xmuoj-vscode-0.0.87.vsix.

# Files (xmuoj-vscode scope)
- media/toolbar-browse-contests.svg
- media/toolbar-folder.svg
- media/toolbar-init-workspace.svg
- media/toolbar-login.svg
- media/toolbar-open-contest.svg
- media/toolbar-refresh-contest.svg
- package.json
- src/extension.js
- src/treeData.js

# Notes
- This PR description intentionally scopes to xmuoj-vscode changes only.
- Exclude local snapshot/runtime artifacts (such as temp-old-vsix and xmuoj/* workspace data) from final merge if they appear in the branch.