<script setup>
/**
 * 单轮回合输入。
 *
 * 三个折叠区：
 *   1. 夜晚（死亡 + 我的技能）—— 🔴 硬必需
 *   2. 发言（每个存活玩家一段）—— 🟡 软必需
 *   3. 票型（谁投谁）—— 🔴 硬必需
 *
 * 卡片化原则（Q7 决策 A）：
 *   - 死亡：点座位号
 *   - 票型：from→to 网格
 *   - 我的技能：唯一自由文本（多角色有不同动作）
 *   - 发言：自由文本（语音接口预留，MVP 用 textarea）
 */
import { computed, ref } from 'vue';
import { game, currentRound, RULE_VERSIONS, BOARDS } from '../stores/game.js';
import VoiceRecorder from './VoiceRecorder.vue';

const r = computed(() => currentRound());

const expanded = ref({
  night: true,
  captain: true, // 第 1 轮默认展开上警
  speech: false,
  vote: false,
});

/**
 * 是否显示「上警」卡片。
 * 条件：第 1 轮 + 板子有警长 + 规则未勾「无警长」
 * 注意 no_captain_9p 这个 key 名虽含 9p，但语义统一表示"本局无警长"，
 * 12 人局勾上同样生效。
 */
const showCaptain = computed(() => {
  if (r.value?.round !== 1) return false;
  const preset = game.setup.board ? BOARDS[game.setup.board] : null;
  if (!preset?.hasCaptain) return false;
  return !game.setup.ruleVersion?.no_captain_9p;
});

function toggleDeath(seat) {
  const idx = r.value.deaths.indexOf(seat);
  if (idx >= 0) r.value.deaths.splice(idx, 1);
  else r.value.deaths.push(seat);
}

function toggleArr(arr, seat) {
  const idx = arr.indexOf(seat);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(seat);
}

function addCaptainSpeech() {
  r.value.captain.speeches.push({ seat: null, text: '' });
}

function removeCaptainSpeech(i) {
  r.value.captain.speeches.splice(i, 1);
}

function onCaptainTranscribed(i, text) {
  const s = r.value.captain.speeches[i];
  if (!s) return;
  if (s.text && s.text.trim()) {
    s.text = s.text.trimEnd() + '\n' + text;
  } else {
    s.text = text;
  }
}

function pickElected(seat) {
  r.value.captain.elected = r.value.captain.elected === seat ? null : seat;
}

function addVote() {
  r.value.votes.push({ from: null, to: null });
}

function removeVote(i) {
  r.value.votes.splice(i, 1);
}

function addSpeech() {
  r.value.speeches.push({ seat: null, text: '' });
}

function removeSpeech(i) {
  r.value.speeches.splice(i, 1);
}

/** 彄音转写结果合并到对应发言框。已有内容则换行追加，避免误覆盖。 */
function onTranscribed(i, text) {
  const s = r.value.speeches[i];
  if (!s) return;
  if (s.text && s.text.trim()) {
    s.text = s.text.trimEnd() + '\n' + text;
  } else {
    s.text = text;
  }
}

const alivePlayers = computed(() => game.players.filter((p) => p.alive));

function isHardReady() {
  // 硬必需：死亡情况已确认（哪怕"昨晚没人死"也要明确标记）
  //   + 用户技能描述（若用户是夜间技能角色）
  const myRole = game.setup.myRole;
  const hasSkillRole = ['预言家', '女巫', '守卫', '狼人', '狼王', '白狼王'].includes(myRole);
  const skillOK = hasSkillRole ? r.value.mySkill.trim().length > 0 : true;
  return skillOK;
}
</script>

<template>
  <div class="space-y-3">
    <!-- 夜晚 -->
    <div class="card">
      <button
        class="w-full flex items-center justify-between text-left"
        @click="expanded.night = !expanded.night"
      >
        <div>
          <div class="font-semibold flex items-center gap-2">
            <span class="text-wolf-400">🔴 硬必需</span> 夜晚报告
          </div>
          <div class="text-xs text-zinc-500 mt-0.5">
            {{ r.deaths.length ? `出局: ${r.deaths.join(', ')}` : '无人出局 / 未标记' }}
          </div>
        </div>
        <div class="text-2xl text-zinc-500">{{ expanded.night ? '⌄' : '›' }}</div>
      </button>

      <div v-if="expanded.night" class="mt-3 space-y-3">
        <div>
          <div class="text-sm text-zinc-400 mb-2">昨晚出局（点击座位）</div>
          <div class="grid grid-cols-6 gap-2">
            <button
              v-for="p in game.players"
              :key="p.seat"
              :class="[
                'aspect-square rounded-lg border-2 text-sm font-semibold active:scale-95 transition',
                r.deaths.includes(p.seat)
                  ? 'bg-wolf-700 border-wolf-600 text-white line-through'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-200',
                p.isMe ? 'ring-1 ring-wolf-500' : '',
              ]"
              @click="toggleDeath(p.seat)"
            >
              {{ p.seat }}
            </button>
          </div>
          <div class="text-xs text-zinc-500 mt-1">全部不选 = 昨晚无人出局</div>
        </div>

        <div>
          <div class="text-sm text-zinc-400 mb-2">
            我（{{ game.setup.myRole }}）夜间技能使用
          </div>
          <textarea
            v-model="r.mySkill"
            rows="2"
            class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm focus:outline-none focus:border-wolf-500"
            :placeholder="{
              预言家: '例：验了 4 号，金水',
              女巫: '例：解药救了 5 号（被刀），未撒毒',
              守卫: '例：守了 9 号',
              狼人: '例：刀了 5 号，狼队决定悍跳',
              狼王: '例：刀了 5 号',
              白狼王: '例：刀了 5 号',
            }[game.setup.myRole] || '此身份无夜间技能'"
          />
        </div>
      </div>
    </div>

    <!-- 上警（仅第 1 轮 + 有警长） -->
    <div v-if="showCaptain" class="card">
      <button
        class="w-full flex items-center justify-between text-left"
        @click="expanded.captain = !expanded.captain"
      >
        <div>
          <div class="font-semibold flex items-center gap-2">
            <span class="text-purple-400">🟣 第1轮</span> 上警环节
          </div>
          <div class="text-xs text-zinc-500 mt-0.5">
            {{
              r.captain.elected
                ? `警长：${r.captain.elected}号`
                : r.captain.runners.length
                ? `上警 ${r.captain.runners.length} 人 / 未选出`
                : '未标记'
            }}
          </div>
        </div>
        <div class="text-2xl text-zinc-500">{{ expanded.captain ? '⌄' : '›' }}</div>
      </button>

      <div v-if="expanded.captain" class="mt-3 space-y-3">
        <!-- 上警玩家 -->
        <div>
          <div class="text-sm text-zinc-400 mb-2">上警玩家（点击切换）</div>
          <div class="grid grid-cols-6 gap-2">
            <button
              v-for="p in game.players"
              :key="p.seat"
              :class="[
                'aspect-square rounded-lg border-2 text-sm font-semibold active:scale-95 transition',
                r.captain.runners.includes(p.seat)
                  ? 'bg-purple-700 border-purple-500 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-200',
                p.isMe ? 'ring-1 ring-wolf-500' : '',
              ]"
              @click="toggleArr(r.captain.runners, p.seat)"
            >
              {{ p.seat }}
            </button>
          </div>
        </div>

        <!-- 退水玩家 -->
        <div v-if="r.captain.runners.length">
          <div class="text-sm text-zinc-400 mb-2">退水玩家（从上警名单中点出退水）</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="seat in r.captain.runners"
              :key="`wd-${seat}`"
              :class="[
                'px-3 py-1.5 rounded-lg border text-sm transition',
                r.captain.withdrawn.includes(seat)
                  ? 'bg-zinc-700 border-zinc-500 text-zinc-300 line-through'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-zinc-500',
              ]"
              @click="toggleArr(r.captain.withdrawn, seat)"
            >
              {{ seat }}号{{ r.captain.withdrawn.includes(seat) ? ' · 退水' : '' }}
            </button>
          </div>
        </div>

        <!-- 警上发言 -->
        <div>
          <div class="text-sm text-zinc-400 mb-2">警上发言（按需添加）</div>
          <div class="space-y-2">
            <div
              v-for="(s, i) in r.captain.speeches"
              :key="`cap-${i}`"
              class="bg-zinc-950 rounded-lg p-2 space-y-2"
            >
              <div class="flex items-center gap-2">
                <select
                  v-model="s.seat"
                  class="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
                >
                  <option :value="null">座位</option>
                  <option v-for="p in game.players" :key="p.seat" :value="p.seat">
                    {{ p.seat }}{{ p.isMe ? '（我）' : '' }}
                  </option>
                </select>
                <div class="ml-auto">
                  <VoiceRecorder
                    @transcribed="(text) => onCaptainTranscribed(i, text)"
                  />
                </div>
                <button
                  class="btn-ghost text-xs text-wolf-400"
                  @click="removeCaptainSpeech(i)"
                >
                  删除
                </button>
              </div>
              <textarea
                v-model="s.text"
                rows="3"
                class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm focus:outline-none focus:border-purple-500"
                placeholder="可直接输入，或点【开始录音】让 Whisper 转写"
              />
            </div>
            <button class="btn-secondary w-full text-sm" @click="addCaptainSpeech">
              + 添加警上发言
            </button>
          </div>
        </div>

        <!-- 当选警长 -->
        <div>
          <div class="text-sm text-zinc-400 mb-2">当选警长（单选，可空）</div>
          <div class="grid grid-cols-6 gap-2">
            <button
              v-for="p in game.players"
              :key="`el-${p.seat}`"
              :class="[
                'aspect-square rounded-lg border-2 text-sm font-semibold active:scale-95 transition',
                r.captain.elected === p.seat
                  ? 'bg-gold-500 border-gold-400 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-200',
              ]"
              @click="pickElected(p.seat)"
            >
              {{ p.seat }}
            </button>
          </div>
        </div>

        <!-- 警徽流 -->
        <div>
          <div class="text-sm text-zinc-400 mb-2">警徽流（可选，预言家常用）</div>
          <textarea
            v-model="r.captain.badgeFlow"
            rows="2"
            class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm focus:outline-none focus:border-purple-500"
            placeholder="例：金水留 7 号，查杀留 3 号"
          />
        </div>
      </div>
    </div>

    <!-- 发言 -->
    <div class="card">
      <button
        class="w-full flex items-center justify-between text-left"
        @click="expanded.speech = !expanded.speech"
      >
        <div>
          <div class="font-semibold flex items-center gap-2">
            <span class="text-gold-500">🟡 软必需</span> 白天发言
          </div>
          <div class="text-xs text-zinc-500 mt-0.5">
            {{ r.speeches.length ? `${r.speeches.length} 条记录` : '可跳过，分析时在【追问】补问' }}
          </div>
        </div>
        <div class="text-2xl text-zinc-500">{{ expanded.speech ? '⌄' : '›' }}</div>
      </button>

      <div v-if="expanded.speech" class="mt-3 space-y-2">
        <div
          v-for="(s, i) in r.speeches"
          :key="i"
          class="bg-zinc-950 rounded-lg p-2 space-y-2"
        >
          <div class="flex items-center gap-2">
            <select
              v-model="s.seat"
              class="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
            >
              <option :value="null">座位</option>
              <option v-for="p in game.players" :key="p.seat" :value="p.seat">
                {{ p.seat }}{{ p.isMe ? '（我）' : '' }}
              </option>
            </select>
            <div class="ml-auto">
              <VoiceRecorder
                @transcribed="(text) => onTranscribed(i, text)"
              />
            </div>
            <button
              class="btn-ghost text-xs text-wolf-400"
              @click="removeSpeech(i)"
            >
              删除
            </button>
          </div>
          <textarea
            v-model="s.text"
            rows="3"
            class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm focus:outline-none focus:border-wolf-500"
            placeholder="可直接输入，或点【开始录音】让 Whisper 转写"
          />
        </div>
        <button class="btn-secondary w-full text-sm" @click="addSpeech">
          + 添加发言
        </button>
        <div class="text-xs text-zinc-500">
          💡 选座位 → 点【开始录音】录该玩家发言 → 自动转写到文本框。
        </div>
      </div>
    </div>

    <!-- 票型 -->
    <div class="card">
      <button
        class="w-full flex items-center justify-between text-left"
        @click="expanded.vote = !expanded.vote"
      >
        <div>
          <div class="font-semibold flex items-center gap-2">
            <span class="text-wolf-400">🔴 硬必需</span> 票型
          </div>
          <div class="text-xs text-zinc-500 mt-0.5">
            {{ r.votes.length ? `${r.votes.length} 票` : '未记录' }}
          </div>
        </div>
        <div class="text-2xl text-zinc-500">{{ expanded.vote ? '⌄' : '›' }}</div>
      </button>

      <div v-if="expanded.vote" class="mt-3 space-y-2">
        <div
          v-for="(v, i) in r.votes"
          :key="i"
          class="flex items-center gap-2"
        >
          <select
            v-model="v.from"
            class="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm flex-1"
          >
            <option :value="null">投票人</option>
            <option v-for="p in game.players" :key="p.seat" :value="p.seat">
              {{ p.seat }}号{{ p.isMe ? '（我）' : '' }}
            </option>
          </select>
          <span class="text-zinc-500">→</span>
          <select
            v-model="v.to"
            class="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm flex-1"
          >
            <option :value="null">弃票</option>
            <option v-for="p in game.players" :key="p.seat" :value="p.seat">
              {{ p.seat }}号
            </option>
          </select>
          <button
            class="btn-ghost text-xs text-wolf-400"
            @click="removeVote(i)"
          >
            ×
          </button>
        </div>
        <button class="btn-secondary w-full text-sm" @click="addVote">
          + 添加一票
        </button>
      </div>
    </div>
  </div>
</template>
