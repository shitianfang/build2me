# build2me（中文简介）

**用 prove2me 的协议造软件**：不可变契约 DAG、无锁乐观并发、每个节点一条机器可判的验收、级联验证、一个标量当调度器——没有任务板、没有认领、没有人工合并瓶颈。

[Prove2Me](https://arxiv.org/abs/2608.28433) 让一群 Claude agent 在 11 天内[完成了费马大定理的 Lean 形式化](https://www.anthropic.com/research/formalizing-fermats-last-theorem)：三万条定理无人逐条审阅，信任完全落在"检查器 + 不可变的、经人工审计的陈述"上。它的作者先试过两条显然的路——多 agent 共同编辑文件（互相干扰、无法分割）和 git PR 流程（人工审并成为瓶颈）——都失败了才发明这套协议。而这两个失败恰好就是今天多 agent 写软件的现状。

build2me 把该协议移植到工程领域，并为软件与数学不同的两处明确付费：

1. **组合不是免费的**——子契约各自通过不代表父级能工作，所以父契约的验收是级联时真实执行的集成门；
2. **陈述会变**——需求漂移；契约从不修改，只废止（append-only），废止会级联重开下游。

协议全文见 [PROTOCOL.md](PROTOCOL.md)（英文）：一个 agent 读完即可正确参与。

## 快速开始

需要 Node >= 20 与 git，零依赖：

```sh
node tools/verify.mjs     # 内核：状态、判决、验收门
node tools/frontier.mjs   # 调度器：下一步做什么，按级联杠杆排序
```

内置微型示例项目（一个已完成叶子 + 一个开放叶子 + 一个草案父级）：

```sh
node tools/verify.mjs   --dir acceptance/fixtures/demo
node tools/frontier.mjs --dir acceptance/fixtures/demo
```

[acceptance/example-flow.test.mjs](acceptance/example-flow.test.mjs) 在 CI 里完整演示：实现开放的 `mul` 契约后，父级 `calc` 经级联自动转为 Done。

## 本仓库自举

build2me 用它自己的协议开发自己：系统即 `root` 契约，分解为九个子契约；验证器、前沿工具、不可变检查、协议文档、示例流程已 Done（它们的验收就是本仓库 CI），其余四个是**真实的开放前沿**——`node tools/frontier.mjs` 打印的就是贡献指南本身。
