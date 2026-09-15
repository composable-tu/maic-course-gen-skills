<!--
SPDX-FileCopyrightText: 2026 THU-MAIC
SPDX-License-Identifier: MIT

来源：THU-MAIC/OpenMAIC  https://github.com/THU-MAIC/OpenMAIC
路径：skills/  同步 commit：3edaa499
本文件为上游原文，按 MIT 许可分发；许可证全文见仓库根目录 LICENSE-openmaic。
-->

# Clone Or Reuse Existing Repo

## Goal

Establish which OpenMAIC checkout will be used for setup and runtime actions.

## Procedure

1. Check whether OpenMAIC already exists locally.
2. If a checkout exists, show the path and ask whether to reuse it.
3. If no checkout exists, propose cloning the repo and ask for confirmation.
4. After clone, confirm dependency installation separately.

## Recommended Path

- Recommended: reuse an existing checkout if it is already on the target branch.
- Otherwise: clone a fresh checkout from GitHub, then install dependencies.

## Commands

Clone:

```bash
git clone https://github.com/THU-MAIC/OpenMAIC.git
cd OpenMAIC
```

Install dependencies:

```bash
pnpm install
```

## Confirmation Requirements

- Ask before `git clone`.
- Ask before `pnpm install`.
- If the repo is dirty, tell the user and ask whether to continue with that checkout.
