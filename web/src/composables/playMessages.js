/**
 * Play 页面的 prompt 构造逻辑（P2-13 从 Play.vue 抽出）。
 *
 * - buildKnownFacts / renderRoundDetail：纯函数，不依赖 store
 * - buildMessages：依赖 game store + 调用方传入 preset / currentRoundObj
 */
import { game } from '../stores/game.js';

/**
 * 构造历史已知事实摘要（紧凑版，供常规分析用）。
 * @param {Array} pastRounds 历史轮次（不含当前轮）
 * @returns {string}
 */
export function buildKnownFacts(pastRounds) {
  if (!pastRounds.length) return '';
  const lines = ['## 历史已知事实（前 ' + pastRounds.length + ' 轮）'];

  // 累积死亡（跨轮去重，记录首次出局轮次）
  const seenDead = new Set();
  const allDead = [];
  for (const round of pastRounds) {
    for (const seat of round.deaths) {
      if (!seenDead.has(seat)) {
        seenDead.add(seat);
        allDead.push([seat, round.round]);
      }
    }
  }
  if (allDead.length) {
    lines.push('- 累计出局：' + allDead.map(([s, r]) => `${s}号(R${r})`).join('、'));
  }

  // 警长 + 警徽流（仅 R1）
  const r1 = pastRounds.find((x) => x.round === 1);
  if (r1?.captain) {
    const cap = r1.captain;
    if (cap.elected) {
      let capLine = `- 警长：${cap.elected}号`;
      if (cap.badgeFlow) capLine += `（警徽流：${cap.badgeFlow}）`;
      lines.push(capLine);
    } else if (cap.runners.length) {
      lines.push('- 警长：未选出（PK / 流局）');
    }
  }

  // 我的夜间技能历史
  const skillHist = pastRounds.filter((x) => x.mySkill && x.mySkill.trim());
  if (skillHist.length) {
    lines.push('- 我的夜间技能：');
    for (const x of skillHist) {
      lines.push(`  · R${x.round}：${x.mySkill.trim()}`);
    }
  }

  // 历轮票型
  const voteHist = pastRounds.filter((x) => x.votes.length);
  if (voteHist.length) {
    lines.push('- 历轮票型：');
    for (const x of voteHist) {
      const votes = x.votes.map((v) => `${v.from || '?'}号->${v.to ? v.to + '号' : '弃'}`).join('，');
      lines.push(`  · R${x.round}：${votes}`);
    }
  }

  return lines.join('\n');
}

/**
 * 渲染单轮完整原文（夜晚 + 上警 + 发言 + 票型）。
 * 复盘模式和非复盘的"当前轮"都用它。
 */
export function renderRoundDetail(round, lines) {
  lines.push('');
  lines.push(`### 第 ${round.round} 轮`);
  lines.push(`出局：${round.deaths.length ? round.deaths.join(', ') + '号' : '无人出局'}`);
  if (round.mySkill) {
    lines.push(`我夜间技能：${round.mySkill}`);
  }
  // 上警环节（仅第 1 轮有数据时输出）
  if (round.captain) {
    const cap = round.captain;
    const hasCapInfo =
      cap.runners.length ||
      cap.withdrawn.length ||
      cap.speeches.length ||
      cap.elected ||
      cap.badgeFlow;
    if (hasCapInfo) {
      lines.push('上警环节：');
      if (cap.runners.length) {
        const active = cap.runners.filter((s) => !cap.withdrawn.includes(s));
        lines.push(`- 上警：${cap.runners.join(', ')}号`);
        if (cap.withdrawn.length) {
          lines.push(`- 退水：${cap.withdrawn.join(', ')}号（最终参选 ${active.length ? active.join(', ') + '号' : '无'}）`);
        }
      }
      if (cap.speeches.length) {
        lines.push('- 警上发言：');
        for (const s of cap.speeches) {
          lines.push(`  - ${s.seat ? s.seat + '号' : '?'}：${s.text}`);
        }
      }
      if (cap.elected) {
        lines.push(`- 当选警长：${cap.elected}号`);
      } else if (cap.runners.length) {
        lines.push('- 当选警长：未选出（PK / 流局）');
      }
      if (cap.badgeFlow) {
        lines.push(`- 警徽流：${cap.badgeFlow}`);
      }
    }
  }
  if (round.speeches.length) {
    lines.push('白天发言：');
    for (const s of round.speeches) {
      lines.push(`- ${s.seat ? s.seat + '号' : '?'}：${s.text}`);
    }
  }
  if (round.votes.length) {
    lines.push('票型：');
    for (const v of round.votes) {
      lines.push(`- ${v.from || '?'}号 -> ${v.to ? v.to + '号' : '弃票'}`);
    }
  }
}

/**
 * 构造发给 LLM 的对话上下文。
 * @param {{ preset: object|null, currentRoundObj: object, forReview?: boolean }} opts
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessages({ preset, currentRoundObj, forReview = false }) {
  const setup = game.setup;
  const lines = [];

  if (forReview) {
    lines.push('# 对局复盘请求');
    lines.push('请按 SKILL.md【终局复盘】段输出复盘模板。');
    lines.push('');
  }

  lines.push(`## 本局配置`);
  lines.push(`- 板子：${setup.board}（共 ${preset?.total ?? '?'} 人）`);
  // P1-6：自定义板子补描述
  if (setup.board?.startsWith('自定义：') && setup.boardDesc) {
    lines.push(`- 板子描述：${setup.boardDesc}`);
  }
  lines.push(`- 我的身份：${setup.myRole}`);
  lines.push(`- 我的座位：${setup.mySeat}号`);
  if (setup.playerStyles) {
    lines.push(`- 玩家风格备注：${setup.playerStyles}`);
  }
  const versionKeys = Object.entries(setup.ruleVersion)
    .filter(([k, v]) => v)
    .map(([k]) => k);
  if (versionKeys.length) {
    lines.push(`- 规则版本标记：${versionKeys.join(', ')}`);
  }
  lines.push('');

  if (forReview) {
    // 复盘模式：全量所有轮原文（B1 例外，复盘需要完整推理链）
    lines.push(`## 完整对局记录（共 ${game.rounds.length} 轮）`);
    for (const round of game.rounds) {
      renderRoundDetail(round, lines);
    }
  } else {
    // A4：常规分析 = 历史已知事实（紧凑摘要）+ 当前轮完整原文
    const pastRounds = game.rounds.filter((x) => x.round !== game.currentRound);
    const facts = buildKnownFacts(pastRounds);
    if (facts) {
      lines.push(facts);
      lines.push('');
    }
    lines.push(`## 本轮报告（第 ${game.currentRound} 轮）`);
    renderRoundDetail(currentRoundObj, lines);
  }

  lines.push('');
  lines.push('## 存活玩家');
  const alive = game.players.filter((p) => p.alive).map((p) => p.seat);
  lines.push(alive.length ? alive.join(', ') + '号' : '（无）');

  lines.push('');
  lines.push(forReview ? '请按【终局复盘】段输出。' : '请按【输出格式】分析本轮。');

  return [{ role: 'user', content: lines.join('\n') }];
}
