# OpenJudge Backup

This repository is a clean backup of the current working OpenJudge stack.

Included:
- OnlineJudgeDeploy
- OnlineJudge
- OnlineJudgeFE
- JudgeServer
- frontend-compare/cloud-canary

Excluded on purpose:
- SQL dumps
- testcase archives and runtime data
- node_modules, dist, build outputs
- temporary files and local caches

The contents reflect the currently validated local/cloud state, including the frontend switch and rollback scripts.

## Push To GitHub

If GitHub CLI is authenticated on this machine, create and push the backup repository with:

```bash
./create_repo_and_push.sh AndyLishengrui xmuojFE
```

If the repository already exists, push with:

```bash
./push_to_github.sh https://github.com/AndyLishengrui/xmuojFE.git
```
