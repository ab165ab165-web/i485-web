/* sections.js —— 八段分段 / 展示的唯一事实源
 * 顺序 = 页面底色切换顺序；sections 里的 section id 来自 data/questions.js。
 * 段落划分按「实际题量」：21 / 15 / 27 / 23 / 21 / 28 / 21 / 17 = 173
 * accent = 该段的强调色：题卡左竖条、段标题圆点、进度条已完成部分都用它。
 * bg = 页面底色。
 *
 * 2026-11-09 配色收敛：8 段的 accent 统一、bg 统一。
 *   原因：颜色本来不承担「段识别」（README 口径：底色只做冷暖区分），
 *   8 种色相反而让用户误以为颜色有含义。段身份改由三处承担：
 *   ① 切段时的深色横幅  ② 顶栏的「第 N 段 / 共 8 段 · 段名」文字
 *   ③ 进度条的第 N 小节（位置 = 段号）。
 *   字段结构原样保留（accent / bg 仍在表里），回滚只需改回颜色值。
 * blurb = 开场页八段地图 / 切段过渡卡上的一句话：这段在问什么（一句，不列目录编号）。
 *
 * 2026-11-10（v9 批 1）颜色单一事实源：
 *   accent / bg 改成 CSS 变量引用（var(--accent) / var(--bg)），
 *   颜色值全部住在 theme.css（一处改，三套皮肤同时生效）。
 *   这里留 hex 就会变成第二个事实源 —— 改一处主题、另一处不跟着变，必然漂移。
 *   字段名与结构不变（accent / bg 仍是这两个键），回滚口径与上条一致。
 */
window.I485_SECTIONS = [
  { n: 1, key: 'sec1', title: '你靠什么理由申请',        bg: 'var(--bg)', accent: 'var(--accent)', sections: ['application-type'],
    blurb: '先定你按哪一类申请，Part 2 的类别清单全靠这一步。' },
  { n: 2, key: 'sec2', title: '以前申请过吗，要交担保书吗', bg: 'var(--bg)', accent: 'var(--accent)', sections: ['request-for-exemption', 'additional-info'],
    blurb: '问以前有没有申请过，要不要交 I-864 担保书或申请豁免。' },
  { n: 3, key: 'sec3', title: '结过几次婚，孩子几个，长什么样', bg: 'var(--bg)', accent: 'var(--accent)', sections: ['marital-history', 'children-info', 'biographic-info'],
    blurb: '问婚姻史、子女信息，还有身高、眼睛和头发颜色。' },
  { n: 4, key: 'sec4', title: '你入过什么组织，被拒签过吗', bg: 'var(--bg)', accent: 'var(--accent)', sections: ['9a'],
    blurb: '问加入过什么组织、被拒签过，或违反过签证规定。' },
  { n: 5, key: 'sec5', title: '你被抓过、被定过罪吗',    bg: 'var(--bg)', accent: 'var(--accent)', sections: ['9b'],
    blurb: '问逮捕、定罪、家庭暴力这类会被翻旧账的记录。' },
  { n: 6, key: 'sec6', title: '你碰过武器、军警或极权政党吗', bg: 'var(--bg)', accent: 'var(--accent)', sections: ['9c'],
    blurb: '问武器、军警训练，以及极权政党这类安全问题。' },
  { n: 7, key: 'sec7', title: '你领过福利，或在表上说过谎吗', bg: 'var(--bg)', accent: 'var(--accent)', sections: ['9d', '9e'],
    blurb: '问领过的公共福利，以及有没有在表上说过谎。' },
  { n: 8, key: 'sec8', title: '你逾期停留、非法投票过吗', bg: 'var(--bg)', accent: 'var(--accent)', sections: ['9f', '9g', 'interpreter-info'],
    blurb: '问逾期停留、非法投票、递解和再入境记录。' }
];
