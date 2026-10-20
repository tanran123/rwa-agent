<script setup>
import { ref } from "vue";
import { fetchProductFields, fetchProducts } from "@/api/product";
import AsyncView from "@/components/AsyncView.vue";

const products = ref([]);
const code = ref("");
const loadProducts = fetchProducts().then((rows) => {
  products.value = rows;
  code.value = rows[0] ? rows[0].code : "";
  return rows;
});
const loadFields = () => code.value ? fetchProductFields(code.value) : Promise.resolve([]);
const current = () => products.value.find((item) => item.code === code.value) || {};
</script>

<template>
  <AsyncView :load="() => loadProducts">
    <template #default>
      <div class="grid c4" style="margin-bottom: 14px">
        <div
          v-for="item in products"
          :key="item.code"
          class="fblock"
          :style="{ cursor: 'pointer', borderColor: code === item.code ? 'var(--brand-2)' : '' }"
          @click="code = item.code"
        >
          <div class="fh">
            <span
              :style="{
                width: '22px', height: '22px', borderRadius: '5px', background: item.color, color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: '700', flex: '0 0 22px'
              }"
            >{{ item.icon }}</span>
            <span class="fname">{{ item.label }}</span>
            <span class="fcode">{{ item.code }}</span>
          </div>
          <div class="fmean" style="font-size: 11px">{{ item.desc }}</div>
          <div class="fmeta">
            <span>{{ item.fieldCount }} 个标准字段</span>
            <span>{{ item.system }}</span>
            <span class="tag" :class="item.onboarding === 'manual' ? 'warn' : 'muted'">{{ item.onboarding === 'manual' ? '人工录入' : '列式导入' }}</span>
          </div>
        </div>
      </div>
      <AsyncView :key="code" :load="loadFields">
        <template #default="{ data }">
          <div class="panel">
            <div class="panel-head">
              <h3>{{ current().label }} · 标准字段配置</h3>
              <span class="sub">{{ data.length }} 个字段，其中 {{ data.filter((row) => row.required).length }} 个必填 · 关联监管规则版本 {{ current().ruleVersion }}</span>
            </div>
            <div class="panel-body tight">
              <table class="tbl compact">
                <thead>
                  <tr><th>字段编码</th><th>标准字段名称</th><th>对应规则字段</th><th>数据类型</th><th>必填</th><th>来源系统</th><th>来源字段</th><th>转换规则</th><th>被引用</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in data" :key="row.code">
                    <td class="mono">{{ row.code }}</td>
                    <td>{{ row.name }}</td>
                    <td class="mono">{{ row.stdField || "—" }}</td>
                    <td><span class="tag outline">{{ row.type }}{{ row.unit ? " · " + row.unit : "" }}</span></td>
                    <td><span class="tag" :class="row.required ? 'danger' : 'muted'">{{ row.required ? "必填" : "选填" }}</span></td>
                    <td>{{ row.sourceSystem }}</td>
                    <td class="mono">{{ row.sourceField }}</td>
                    <td>{{ row.transform }}</td>
                    <td><span class="tag" :class="(row.referencedBy || []).length ? 'brand' : 'muted'">{{ (row.referencedBy || []).length ? (row.referencedBy.length + " 条条款") : "—" }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </AsyncView>
    </template>
  </AsyncView>
</template>
