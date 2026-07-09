# 校缘聚 CampusGather API 摘要

统一响应：

```json
{ "success": true, "data": {} }
```

失败响应：

```json
{ "success": false, "error": { "code": "CONFLICT", "message": "该组局名额已满" } }
```

鉴权方式：登录或注册后将返回的随机会话 `token` 放入 `Authorization: Bearer <token>`。服务端只保存 token 哈希，默认 24 小时过期；调用退出接口后当前 token 立即失效。

## 登录账号

登录使用昵称和密码，所有初始账号默认密码均为 `abc123456`。

| 昵称 | 角色 | 说明 |
|---|---|---|
| YanTong | student | 刘砚桐，已认证 |
| Jiapu | student | 李佳璞，已认证 |
| Yuchen | student | 苏雨辰，待认证 |
| Lechen | student | 朱乐晨，暂未认证 |
| 系统管理员 | admin | 史傅冠华，系统管理员 |
| 社团空间管理员 | venue_admin | 场地管理员演示账号 |

## 主要接口

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 公开 | 健康检查 |
| POST | `/api/auth/login` | 公开 | 昵称密码登录 |
| POST | `/api/auth/register` | 公开 | 注册未认证学生账号 |
| POST | `/api/auth/logout` | 登录 | 撤销当前会话 token |
| GET/PUT | `/api/users/me` | 登录 | 当前用户资料 |
| POST | `/api/users/me/password` | 登录 | 输入旧密码修改新密码 |
| POST | `/api/users/me/auth` | 学生 | 提交或重新提交实名认证申请 |
| GET | `/api/users/me/credit` | 登录 | 个人信用记录 |
| GET/POST/PATCH | `/api/games` | 公开/管理员 | 游戏库查询与维护 |
| GET/POST | `/api/sessions` | 公开/认证学生 | 查询和发布组局；查询支持 `type`、`tag`、`keyword`、`page`、`pageSize` |
| GET/PATCH | `/api/sessions/:id` | 公开/发起人 | 组局详情与编辑 |
| POST | `/api/sessions/:id/applications` | 认证学生 | 报名或提交申请 |
| PATCH | `/api/applications/:id` | 发起人 | 审核报名 |
| POST | `/api/sessions/:id/leave` | 成员 | 退出组局 |
| POST | `/api/sessions/:id/finish` | 发起人 | 活动开始后标记完成并开启互评 |
| POST | `/api/sessions/:id/fail` | 发起人 | 活动开始后标记未组局成功 |
| POST | `/api/sessions/:id/reviews` | 成员 | 活动互评 |
| GET/POST/PATCH | `/api/venue-reservations` | 发起人/场地管理员 | 场地申请和审核 |
| GET/POST/PATCH | `/api/venues` | 公开/场地管理员 | 场地查询和维护 |
| GET/POST/PATCH | `/api/complaints` | 学生/管理员 | 投诉提交和处理 |
| GET/PATCH | `/api/notifications` | 登录 | 通知列表和已读 |
| GET | `/api/admin/stats` | 管理员 | 平台统计 |
| GET | `/api/admin/logs` | 管理员 | 操作日志 |
