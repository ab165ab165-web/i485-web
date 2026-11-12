/* font-check.js —— 标题字体可用性检测（v9 字体批）
 *
 * 目的：Chrome 以 file:// 打开时会把同目录 woff2 当跨源资源拦掉（控制台报
 * CORS / "Not allowed to load local resource"）。这时不能让标题停在
 * font-display: swap 的半吊子状态，也不能悄悄变成别的字——显式给 <html>
 * 加 .no-serif，CSS 里有对应规则，直接回落到系统宋体栈。
 *
 * 判定用 FontFace.status（比 document.fonts.check() 可靠：check() 对
 * 不存在的 family 也可能返回 true）。document.fonts.load() 会主动请求字体，
 * 加载失败时该 FontFace 的 status 变 error，promise 也可能 reject，两条都兜。
 *
 * 不做的事：不改文案、不碰答题逻辑、不发任何网络请求（只读本地 woff2）。
 */
(function () {
  var root = document.documentElement;
  function fallback() { root.classList.add('no-serif'); }
  if (!document.fonts || !document.fonts.load) { fallback(); return; }
  var probe = '600 26px "I485 Serif"';
  document.fonts.load(probe, '这张表').then(function (faces) {
    var f = faces && faces[0];
    if (!f || f.status !== 'loaded') fallback();
  }, fallback);
})();
