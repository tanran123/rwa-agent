# 香港 STC 监管配置与 RWA 计量向导自动化测试

## 测试范围

- 监管规则版本 `HK-SA-2026.1`
- 暴露分类、风险权重、产品注册、字段映射、参数表、监管名单
- 产品管理、产品配置工作台、EAD、信用风险缓释页面
- 信用风险 RWA 计量向导九步流程
- 20 个案例的端到端计量：产品族、暴露类别、押品/资产类型、表内/表外、EAD、风险权重、RWA

## 文件

- `TEST_CASES.md`：测试用例清单（REG-01～REG-30、WIZ-01～WIZ-21，共 51 条）
- `fixtures/STC_20_CASES.xlsx`：20 案例测试工作簿
- `fixtures/INCOMPLETE_LOAN.xlsx`：候选暴露类型不匹配的负向案例
- `fixtures/STC_LOAN_FULL.xlsx`：覆盖贷款产品全部标准字段的工作簿，用于规则留痕界面测试
- `run-tests.mjs`：自动化测试脚本

## 运行

先确保服务已启动：

```bash
./start.sh
cd client && npm run dev
```

执行：

```bash
node tests/hk-regulatory/run-tests.mjs
```

可选环境变量：

```bash
PLAYWRIGHT_CORE=/path/to/playwright-core \
CHROME_PATH=/path/to/chrome \
BASE_URL=http://127.0.0.1:5173 \
node tests/hk-regulatory/run-tests.mjs
```

只跑指定用例：

```bash
ONLY=REG-03,WIZ-08 node tests/hk-regulatory/run-tests.mjs
```

## 测试数据准备和恢复

脚本会自动：

1. 备份当前 `ead_product_config`、`ead_product_rule` 和主权/PSE 名单行。
2. 为香港 8 个产品族临时配置测试 EAD 规则。
3. 为 `SOV-TEST`、`PSE-TEST` 临时插入名单行。
4. 执行完成后恢复 EAD 配置和名单行。
5. 清理测试创建的主任务和计量批次。

如果脚本异常中断，需检查并恢复 `ead_product_config`、`ead_product_rule`、`rule_list` 的测试数据。

## 输出

每次运行写入：

```text
output/tests/hk-regulatory/<timestamp>/
  REPORT.md
  results.json
  exposure-overview.png
  task-workbench.png
```

`REPORT.md` 包含每条用例的 PASS/FAIL/SKIP 和实际结果。
