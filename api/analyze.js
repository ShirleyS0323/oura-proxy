export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const { date, ouraToken } = body ?? {};
  if (!date || !ouraToken) return res.status(400).json({ error: 'Missing date or ouraToken' });

  // Fetch all Oura data server-side (no CORS issue here)
  const headers = { Authorization: `Bearer ${ouraToken}` };
  const [sleepRes, readinessRes, dailySleepRes] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${date}&end_date=${date}`, { headers }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, { headers }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${date}`, { headers }),
  ]);

  if (!sleepRes.ok) return res.status(502).json({ error: `Oura API error: ${sleepRes.status}` });

  const [sleepData, readinessData, dailySleepData] = await Promise.all([
    sleepRes.json(), readinessRes.json(), dailySleepRes.json()
  ]);

  if (!sleepData.data || sleepData.data.length === 0) {
    return res.status(404).json({ error: `${date} 没有找到睡眠数据` });
  }

  const sessions = sleepData.data.filter(d => d.type === 'long_sleep' || d.type === 'sleep');
  const s = sessions.length > 0 ? sessions[sessions.length - 1] : sleepData.data[sleepData.data.length - 1];
  const readiness = readinessData.data?.[0];
  const dailySleep = dailySleepData.data?.[0];

  const score = dailySleep?.score ?? readiness?.score ?? null;
  const totalMins = s.total_sleep_duration ? Math.round(s.total_sleep_duration / 60) : null;

  const sleepSummary = {
    date,
    score,
    total_hours: totalMins ? (totalMins / 60).toFixed(1) : null,
    deep_min: s.deep_sleep_duration ? Math.round(s.deep_sleep_duration / 60) : null,
    rem_min: s.rem_sleep_duration ? Math.round(s.rem_sleep_duration / 60) : null,
    light_min: s.light_sleep_duration ? Math.round(s.light_sleep_duration / 60) : null,
    awake_min: s.awake_time ? Math.round(s.awake_time / 60) : null,
    hrv_avg: s.average_hrv ? Math.round(s.average_hrv) : null,
    resting_hr: s.lowest_heart_rate ?? null,
    efficiency: s.sleep_efficiency ?? null,
    readiness_score: readiness?.score ?? null,
    bedtime_start: s.bedtime_start ?? null,
    bedtime_end: s.bedtime_end ?? null,
    latency: s.sleep_latency ? Math.round(s.sleep_latency / 60) : null,
  };

  const fmt = (mins) => {
    if (!mins) return '未知';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}小时${m > 0 ? m + '分钟' : ''}` : `${m}分钟`;
  };

  const prompt = `你是一位结合现代睡眠科学和中医体质学的健康顾问，正在为Shirley（水冰月）做每日睡眠分析。

Shirley的背景：
- 生活习惯：关注TCM养生、精油疗愈、植物护理、烹饪
- 当前状态：准备TCF法语考试（5月16日），同时在进行求职
- 常用精油：乳香、没药、鼠尾草、薄荷、佛手柑、迷迭香

今日（${date}）Oura Ring 睡眠数据：
- 睡眠评分：${sleepSummary.score ?? '未知'}/100
- 总睡眠：${sleepSummary.total_hours ?? '未知'}小时
- 深睡眠：${fmt(sleepSummary.deep_min)}
- REM睡眠：${fmt(sleepSummary.rem_min)}
- 浅睡眠：${fmt(sleepSummary.light_min)}
- 清醒时间：${fmt(sleepSummary.awake_min)}
- HRV均值：${sleepSummary.hrv_avg ?? '未知'}ms
- 静息心率最低：${sleepSummary.resting_hr ?? '未知'}bpm
- 睡眠效率：${sleepSummary.efficiency ? (sleepSummary.efficiency * 100).toFixed(0) + '%' : '未知'}
- 入睡潜伏期：${sleepSummary.latency ?? '未知'}分钟
- 就绪度评分：${sleepSummary.readiness_score ?? '未知'}/100
- 入睡时间：${sleepSummary.bedtime_start ? new Date(sleepSummary.bedtime_start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '未知'}
- 起床时间：${sleepSummary.bedtime_end ? new Date(sleepSummary.bedtime_end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '未知'}

请用中文给出简洁有温度的分析，结构如下（用markdown h4标题分隔）：

#### 今日元气状态
用1-2句话点出今日整体状态，可结合阴阳/五行视角。

#### 睡眠质量解读
从现代睡眠科学角度解读各指标（深睡/REM/HRV），2-3句核心观察。

#### 中医体质视角
结合数据推断今日气血/阴阳状态，给出1-2条具体养生建议（可涉及她常用的精油、食疗、穴位）。

#### 今日行动建议
3条简短的当天具体建议（学习/运动/饮食/作息），结合她正在备考法语和求职的现实。

语气：像一位懂她的朋友+中医顾问，直接务实，不过度煽情。`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const claudeData = await claudeRes.json();
  const analysis = claudeData.content?.[0]?.text ?? '分析生成失败';

  res.status(200).json({ sleepSummary, analysis });
}
