# 设计报告与代码实现映射

| 设计报告内容 | 代码位置 | 说明 |
|---|---|---|
| 分层架构与 REST 接口 | `src/router.js`, `src/server.js` | 原生 Node HTTP 服务，统一 JSON 响应和错误码。 |
| JSON 数据存储 | `src/database/jsonStore.js` | 每个实体独立 JSON 文件，写入时使用临时文件替换以降低数据损坏风险。 |
| 种子数据 | `src/database/seed.js` | 演示账号、游戏库、初始组局和场地。 |
| 用户/认证/权限 | `src/services/userService.js`, `src/security/` | 昵称密码登录、学生注册、安全会话、个人资料、实名认证审核、账号状态。 |
| 游戏库维护 | `src/services/gameService.js` | 游戏/剧本查询、管理员新增与更新。 |
| 组局发布与报名 | `src/services/sessionService.js` | 发布、编辑、报名、审核、退出、完结、互评、信用流水。 |
| 场地预约审核 | `src/services/venueService.js` | 场地维护、申请、冲突检查、审核和通知。 |
| 投诉与信用 | `src/services/complaintService.js` | 投诉提交、管理员处理、联动信用扣分。 |
| 通知、日志、统计 | `notificationService.js`, `logService.js`, `statsService.js` | 站内通知、后台审计日志、平台统计。 |
| 数据模型设计 | `src/database/seed.js`, `data/*.json` | 用户、游戏、组局、场地、投诉、信用、通知等集合结构与初始数据。 |
| 前端原型 | `public/index.html`, `public/app.js`, `public/styles.css` | 可直接演示学生、系统管理员、场地管理员流程。 |
| 自动化测试 | `test/api.test.js` | 覆盖核心业务接口和权限/冲突规则。 |
