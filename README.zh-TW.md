# DLSS 5 Swapper 中文增強版

<p align="center">
  <a href="README.md"><strong>簡體中文</strong></a> &nbsp;|&nbsp; <strong>繁體中文</strong>
</p>

完整介面與遊戲內疊加層繁體中文化，並修復部分遊戲內建 D3D12 執行階段被誤判為衝突、導致無法安裝的問題

## 這是什麼

這是基於開源專案 [DLSS 5 Swapper](https://github.com/rakanki911/DLSS5-Swapper) 2.2.7 的中文增強版，為 NVIDIA DLSS 5（神經渲染）提供遊戲／模擬器的一鍵安裝與管理。

## 相較於原版

- **完整繁體中文化**：主介面與遊戲內疊加層皆已完整翻譯
- **錯誤修正**：修正部分遊戲（例如 CoD 等）內建的 Win7 D3D12 執行階段被誤判為衝突、導致無法安裝的問題

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/41956418-cb59-4a4a-b938-bc864b182587" />

## 版本號說明

為了方便大家理解，本次新版本號定為 1.0.1。版本號分為兩個部分：整數位跟隨原作者版本，原作者發布新版本時遞增（2.0.1、3.0.1…）；小數位則是中文增強版的更新序號，只有中文增強版更新、而原作者尚未更新時才會變動（1.0.2、1.0.3…）。

## 安裝

不需要任何額外的環境依賴，下載 [Release](https://github.com/hezhixin15/DLSS5-Swapper-Chinese/releases) 中的安裝程式，雙擊安裝後即可使用。

部分遊戲可能會出現渲染 API 辨識錯誤。如果你不知道如何查看自己遊戲所使用的 API，可以下載「MSI Afterburner（微星小飛機）」。如果不清楚如何操作，也可以到抖音或嗶哩嗶哩（Bilibili）搜尋相關教學。

建議在安裝這個中文增強版之前，先將原版解除安裝，再安裝本版本。

## 貢獻者

- [hezhixin15](https://github.com/hezhixin15) — 專案作者與維護者
- [Rakan Alkhaldi](https://github.com/rakanki911) — 原作者
- AI 協助參與部分程式碼邏輯與功能實作

## 致謝

感謝原作者 [Rakan Alkhaldi](https://github.com/rakanki911) 的作品。

## 聲明

本專案部分程式碼與架構方案由 AI 協助編寫與設計，使用的模型包括：

通義千問和 GPT-6 參與部分程式碼邏輯與功能實作。

專案由 hezhixin15 主導維護，AI 作為輔助工具協助開發
