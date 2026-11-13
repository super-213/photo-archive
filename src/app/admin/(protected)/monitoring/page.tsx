import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdministrator } from "@/lib/server/auth";
import { monitoringSummary, formatVital } from "@/lib/server/monitoring";
import { vitalDefinitions, vitalNames } from "@/lib/monitoring";
import { MonitoringRefresh } from "@/components/admin/monitoring-refresh";

export const metadata: Metadata = { title: "运行监测" };
const ratings = { good: "良好", "needs-improvement": "需改善", poor: "较差" };
const sources: Record<string, string> = { "server-error": "服务端", "render-error": "页面渲染", "client-error": "浏览器脚本", "unhandled-rejection": "异步操作" };
const time = (value: number) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });

export default async function MonitoringPage() {
  // Guard the data read as well as the parent layout.
  if (!(await getAdministrator(await headers()))) redirect("/admin");
  const summary = monitoringSummary();
  return (
    <>
      <div className="admin-title"><h1>运行监测</h1><MonitoringRefresh /></div>
      <p className="admin-muted">最近 7 天 · 生产环境的前台浏览体验 · 最多保留 20,000 条记录。P75 表示 75% 的样本不超过此数值，越低越好。</p>
      <p className="admin-muted">收到 {summary.totalSamples} 条指标样本、{summary.totalErrors} 条错误事件。{summary.lastReceived ? `最近接收：${time(summary.lastReceived)}（北京时间）。` : "上线后有访客浏览才会产生数据。"}</p>
      <div className="monitoring-cards">
        {summary.metrics.map((metric) => (
          <section className="monitoring-card" key={metric.name}>
            <h2>{metric.name} <span>{vitalDefinitions[metric.name].label}</span></h2>
            <p className="monitoring-value">{formatVital(metric.name, metric.p75)}</p>
            <p className="admin-muted">P75 · {metric.count} 个样本</p>
            <p className="monitoring-rating" data-rating={metric.rating ?? "empty"}>{metric.rating ? ratings[metric.rating] : "等待采集"}</p>
          </section>
        ))}
      </div>
      <p className="admin-muted">每项指标独立计数，并非访客数。少于 20 个样本时仅供初步观察。INP 需要实际交互，部分指标在离开页面或切到后台后上报；浏览器支持与拦截设置会影响采集。客户端切页通常沿用首次文档加载的指标归属。</p>
      <section className="monitoring-section">
        <h2>按页面查看</h2>
        {summary.paths.length ? <div className="monitoring-table-wrap"><table className="monitoring-table">
          <caption>各页面的指标 P75（括号内为样本数）</caption>
          <thead><tr><th scope="col">页面</th>{vitalNames.map((name) => <th scope="col" key={name}>{name}</th>)}</tr></thead>
          <tbody>{summary.paths.map((row) => <tr key={row.path}><th scope="row">{row.path}</th>{row.metrics.map((metric) => <td key={metric.name}>{formatVital(metric.name, metric.p75)}{metric.count ? ` (${metric.count})` : ""}</td>)}</tr>)}</tbody>
        </table></div> : <p className="admin-muted">暂未收到性能数据。</p>}
      </section>
      <section className="monitoring-section">
        <h2>最近错误</h2>
        <p className="admin-muted">最多显示 30 条。错误事件可能来自同一次故障的不同环节，不等同于故障次数。问题编号可与服务日志核对。</p>
        {summary.recentErrors.length ? <div className="monitoring-table-wrap"><table className="monitoring-table">
          <caption>错误记录（北京时间）</caption>
          <thead><tr><th scope="col">时间</th><th scope="col">页面</th><th scope="col">来源</th><th scope="col">类型 / 问题编号</th></tr></thead>
          <tbody>{summary.recentErrors.map((error, index) => <tr key={index}><td>{time(error.recorded_at)}</td><td>{error.path}</td><td>{sources[error.source] || error.source}</td><td>{error.name}{error.digest ? ` / ${error.digest}` : ""}</td></tr>)}</tbody>
        </table></div> : <p className="admin-muted">暂未收到错误记录。</p>}
      </section>
      <p className="admin-muted">数据保存在本站数据库。不记录 IP、Cookie、查询参数、作品名称或错误正文；管理页面不计入前台性能统计。客户端上报可被伪造，此页面用于运行观察。</p>
    </>
  );
}
