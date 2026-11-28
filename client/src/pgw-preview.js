import { createApp } from "vue";
import PgwPreview from "./PgwPreview.vue";
import "./assets/main.css";
createApp(PgwPreview).mount("#app");
setTimeout(() => {
  const button = document.querySelector(".pgw-empty-proposal .btn.primary");
  if (button) button.click();
}, 700);
