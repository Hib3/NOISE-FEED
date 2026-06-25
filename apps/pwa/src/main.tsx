import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const generatedAsset = (name: string) => `url("${import.meta.env.BASE_URL}assets/generated/${name}")`;
document.documentElement.style.setProperty("--paper-noise-image", generatedAsset("paper-noise.png"));
document.documentElement.style.setProperty("--copier-grain-image", generatedAsset("copier-grain.png"));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // PWA登録に失敗しても閲覧機能は続行する。
    });
  });
}
