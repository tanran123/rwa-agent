<script setup>
const sheets = [
  { name: "ReadMe", desc: "底稿说明、计量范围和汇总", fixed: true },
  { name: "原始债项数据", desc: "导入的原始数据，尚未标准化", fixed: false },
  { name: "暴露分类结果", desc: "逐笔分类结果及命中规则", fixed: false },
  { name: "EAD计算明细", desc: "表内、表外 EAD", fixed: false },
  { name: "RWA计算明细", desc: "风险权重及 RWA", fixed: false }
];
</script>

<template>
  <div class="panel" style="margin-bottom: 12px">
    <div class="panel-head">
      <h3>底稿工作表</h3>
      <span class="sub">业务数据是内置的 31 笔模拟债项，数字与结果明细一致</span>
    </div>
    <div class="panel-body">
      <div class="grid c3">
        <div v-for="item in sheets" :key="item.name" class="fblock">
          <div class="fname">{{ item.name }}<span v-if="item.fixed" class="tag brand" style="margin-left: 6px">必需</span></div>
          <div class="fmean">{{ item.desc }}</div>
        </div>
      </div>
      <div class="btn-group" style="margin-top: 14px">
        <a class="btn primary" href="/api/audit.xlsx">导出 xlsx</a>
      </div>
    </div>
  </div>
</template>
