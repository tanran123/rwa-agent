<script setup>
import { ref } from "vue";
import { fetchExposureClass } from "@/api/exposure";
import { fetchClauses } from "@/api/rule";
import { countNodes } from "@/utils/waterfall";
import AsyncView from "@/components/AsyncView.vue";
import TreeNode from "@/components/TreeNode.vue";
import RuleDetail from "@/components/RuleDetail.vue";

const collapsed = ref({});
const picked = ref(null);
const load = () => Promise.all([
  fetchExposureClass(),
  fetchClauses().catch(() => [])
]);

function toggle(path) {
  collapsed.value = { ...collapsed.value, [path]: !collapsed.value[path] };
}
function expandAll() {
  collapsed.value = {};
}
function choose(payload) {
  picked.value = payload;
}
</script>

<template>
  <AsyncView :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>暴露分类决策树</h3>
          <span class="sub">点击节点看条件。绿框是一条规则，细分在它的下级里。</span>
        </div>
        <div class="tree-toolbar">
          <span class="tag brand">规则节点 {{ countNodes(data[0].document) }} 个</span>
          <span class="tag ok">动态生成</span>
          <span style="flex: 1"></span>
          <button type="button" class="btn sm" @click="expandAll">展开全部</button>
        </div>
        <div class="tree-canvas">
          <div class="tree-h">
            <TreeNode
              v-for="(rule, index) in data[0].document.rules"
              :key="rule.name"
              :node="rule"
              :index="index"
              :path="'/' + index + ':' + rule.name"
              :collapsed="collapsed"
              :selected="picked ? picked.path : ''"
              @select="choose"
              @toggle="toggle"
            />
            <TreeNode
              v-if="data[0].document.otherwise"
              :node="data[0].document.otherwise"
              fallback
              :index="-1"
              path=">otherwise"
              :collapsed="collapsed"
              :selected="picked ? picked.path : ''"
              @select="choose"
              @toggle="toggle"
            />
          </div>
          <div v-if="data[0].document.extensions && data[0].document.extensions.length" style="margin-top: 16px">
            <div class="cond-group-label">银行自定义扩展（挂在已命中的规则之下，不插进 rules 中间）</div>
            <div v-for="(item, index) in data[0].document.extensions" :key="index">
              <div class="notice info" style="margin: 8px 0">attach_to = <code class="mono">{{ item.attach_to }}</code></div>
              <TreeNode
                v-for="(child, childIndex) in item.children || []"
                :key="child.name"
                :node="child"
                :depth="1"
                :index="childIndex"
                :path="'ext' + index + '/' + childIndex + ':' + child.name"
                :collapsed="collapsed"
                :selected="picked ? picked.path : ''"
                @select="choose"
                @toggle="toggle"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="notice info">上方为当前分类规则生成的决策树。点一个节点，从右侧打开规则详情。</div>
      <RuleDetail
        :node="picked && picked.node"
        :path="picked ? picked.path : ''"
        :index="picked ? picked.index : 0"
        :depth="picked ? picked.depth : 0"
        :fallback="!!(picked && picked.fallback)"
        :fields="data[0].document.fields || []"
        :clauses="data[1] || []"
        @close="picked = null"
        @open="choose"
      />
    </template>
  </AsyncView>
</template>
