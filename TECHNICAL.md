# 技術規格

規格狀態：**尚未實作**。本文件定義實作介面與可重現的資料契約，不代表程式或檢查已存在。

## 執行模型與限制

- 正式工具是無伺服器邏輯的靜態原生 HTML、CSS 和瀏覽器 ESM 頁面。沒有外部 runtime dependency、CDN、遠端字型、第三方 API、analytics 或 telemetry。
- Node.js 24+ 僅供離線開發、純函式測試、檢查、靜態 build 和 loopback HTTP 驗收；演算法只用 Node/browser 內建功能。
- 開發預覽命令為 npm run dev，必須只綁定 127.0.0.1:4214，且只提供 public/。不得綁 0.0.0.0 或公開連接埠。
- production 候選預覽使用 127.0.0.1:5214；此流程只在主代理放行 M2 後建立。M1 不建立 production template、正式發布檔或公開 source ZIP。部署及首頁更新僅由主代理在 M3 執行。
- 演算法和日期校驗不得使用 Date、Intl 時區轉換、DST 資料、網路、隨機數或系統目前時間。只有 UI event handler 觸碰 DOM；核心純函式不讀寫全域狀態。

## 建議檔案樹

    package.json
    public/
      index.html
      en/index.html
      styles/app.css
      js/app.mjs
      js/core/meeting-overlap.mjs
    scripts/
      serve.mjs
      check.mjs
      build.mjs
    test/
      core.test.mjs
      app-contract.test.mjs
      static-security.test.mjs

M1 preview build 只複製經檢查的 public/ 到 dist/；dist/ 不含測試、腳本、規格或工作草稿。production 候選使用獨立 dist-production/，不得由 M1 build 默默寫入。具體 M2 production 工具必須由主代理放行後實作，採閉合檔案白名單且和 preview 產物分離。

## 精確 draft schema

核心入口接受由 app 建立的 JSON-like plain data。所有使用者原始值都保留為字串；分鐘數只在驗證成功後變為 number。

    type IntervalDraft = {
      id: string;
      startRaw: string;
      endRaw: string;
    };

    type ParticipantDraft = {
      id: string;
      nameRaw: string;
      intervals: IntervalDraft[];
    };

    type MeetingDraft = {
      dateRaw: string;
      timeBasisRaw: string;
      durationMinutesRaw: string;
      participants: ParticipantDraft[];
    };

結構規則：

1. 每一筆 object 的 prototype 必須是 Object.prototype；不接受 class instance、Date、null-prototype record 或陣列作為 record。
2. 只接受上列精確 own string keys。未知 key、遺漏 key、Symbol key、accessor、非 enumerable 欄位一律拒絕；檢查 descriptor 時不可讀取屬性值或呼叫 getter。欄位順序不影響結果。
3. 每個 raw 欄位必須是原始 primitive string。參與者與區間陣列必須由 Array.isArray 判定為陣列且 prototype 正好是 Array.prototype，沒有 symbol/額外自有屬性、沒有洞，所有 index 都是 enumerable data property。不得先用 map/filter 展開可能有洞的陣列。非陣列或改過 prototype 的陣列以 WRONG_TYPE 回報；陣列 symbol key 用 SYMBOL_KEY；額外自有 property 用 ARRAY_EXTRA_PROPERTY；洞用 ARRAY_NOT_DENSE；index accessor／non-enumerable descriptor 分別用 ACCESSOR_PROPERTY／NON_ENUMERABLE_PROPERTY。
4. 所有字串先受 256 UTF-16 code unit raw 上限；id 受 32 ASCII 字元上限。沒有輸入物件的隱含預設欄位，也不容許未知欄位在 normalize 時被略過。
5. Proxy 的 trap 無法在一般 JavaScript 中安全且通用地偵測；此 API 的呼叫者必須提供 app 產生的普通資料物件。對普通 accessor/getter 必須在取值之前拒絕；不得宣稱可以安全消化任意 Proxy。

欄位內容規則：

| 欄位 | 型別與語法 | 正規化及範圍 |
|---|---|---|
| dateRaw | string；精確 ASCII yyyy-mm-dd | 年 0001–9999；真實 Gregorian 日期；回傳原格式日期標籤 |
| timeBasisRaw | string | trim 後 1–60 Unicode code points；原始最多 256 UTF-16 code units |
| durationMinutesRaw | string；1–4 個 ASCII 數字 | 解析整數 1–1440；接受前導零 |
| participant.id | string；^[a-z][a-z0-9_-]{0,31}$ | 全表唯一；UI 以記憶體計數器產生 p1、p2… |
| participant.nameRaw | string | trim 後 1–40 Unicode code points |
| interval.id | string；同一 ID 語法 | 每位參與者內唯一；UI 以記憶體計數器產生 s1、s2… |
| interval.startRaw | string；精確 HH:MM | ASCII 00:00–23:59；正規化為 0–1439 |
| interval.endRaw | string；精確 HH:MM | ASCII 00:00–23:59 或 24:00；正規化為 0–1440 |

nameRaw 和 timeBasisRaw 先掃描 UTF-16，拒絕未配對 surrogate；拒絕 U+0000–U+001F、U+007F–U+009F 控制碼，不把控制碼當成可隱藏的 trim 字元。其後用 ECMAScript trim()，並以 Array.from(trimmed).length 計 Unicode code points。HTML、標記、方向控制文字、搜尋或時區名稱皆無特殊語意；不採 HTML parser 做正規化。日期、時間、分鐘原始欄位不 trim，任何前後空白都會使格式錯誤。

participant 數量須為 2–20；每人區間 1–12；總段數上限 240。先確認所有陣列具備正確結構並取得 length，若總數超過 240 先回總量錯誤，再檢查每人 1–12。合法結構下 20 × 12 等於 240；總量錯誤是防禦性上限，保留獨立錯誤與測試。

主代理 M1 審查補充（2026-10-19，優先於下文一般結構檢查順序）：陣列型別／prototype 通過後，以 own length data descriptor 先做資源上限檢查，再列舉 keys、洞、index descriptor 或複製元素。participants.length >20 立即回 PARTICIPANT_COUNT_HIGH，path=participants；各 participant 的 intervals.length 若超過尚餘總額 240−先前已驗證區間數，立即回 TOTAL_INTERVALS_HIGH，path=participants，兩個 ID 均為 null。超限分支不讀任何 index 值或 getter，優先於該超限陣列的 symbol／extra／洞／index／row schema 錯誤。上限內仍沿用下文完整驗證優先序（總數檢查後才逐人檢查 1–12）。此措施使元素驗證／複製至多 20 個人及 240 段；不宣稱能對任意巨大未知 own-key 物件或 Proxy 提供常數時間安全。

## 核心函式與回傳型別

核心檔案公開以下純函式：

    type Locale = "zh-Hant" | "en";

    type ValidationError = {
      code: ErrorCode;
      path: string;
      participantId: string | null;
      intervalId: string | null;
    };

    type NormalizedDraft = {
      date: string;
      timeBasis: string;
      meetingDurationMinutes: number;
      participants: Array<{
        id: string;
        name: string;
        intervals: Array<{
          id: string;
          startMinute: number;
          endMinute: number;
        }>;
      }>;
    };

    type MeetingWindow = {
      startMinute: number;
      endMinute: number;
      durationMinutes: number;
      latestStartMinute: number;
    };

    type MeetingResult = {
      date: string;
      timeBasis: string;
      meetingDurationMinutes: number;
      participantCount: number;
      windows: MeetingWindow[];
    };

    type ValidationResult =
      | { ok: true; value: NormalizedDraft }
      | { ok: false; error: ValidationError };

    type CalculationResult =
      | { ok: true; value: MeetingResult }
      | { ok: false; error: ValidationError };

    export function validateDraft(input: unknown): ValidationResult;
    export function calculateMeetingWindows(input: unknown): CalculationResult;
    export function formatClock(minute: number, boundary: "start" | "end"): string | null;
    export function buildPlainTextReport(result: MeetingResult, locale: Locale): string;

所有函式不得改寫 input 或依賴呼叫次序。validateDraft 回傳新建的 normalized objects/arrays；錯誤不包含任何使用者原始值。calculateMeetingWindows 先執行同一 validateDraft，再計算 result；有效空結果仍回 ok:true。formatClock 接受整數 0–1439 作 start、0–1440 作 end；只有 boundary=end 且 minute=1440 才輸出 24:00，其他越界或非整數回 null。buildPlainTextReport 只接受由核心生成的 MeetingResult，確定性產生下節所列字串，不讀取 DOM/locale environment/current time。

## 穩定錯誤碼與優先序

錯誤物件形狀固定；path 只含固定 schema 欄名與十進位陣列索引，不回顯未知 key 或文字。participantId 只在該 ID 已通過語法且全表唯一後填入；intervalId 只在其已通過語法且在該 participant 內唯一後填入。ID 本身錯誤或重複時，相應 ID 欄位為 null。row schema/type 錯誤時兩個 ID 欄位皆為 null。UI 依 code 及 path 映射雙語欄位訊息，不要求顯示 code。

固定 code：

- 結構：ROOT_NOT_PLAIN_OBJECT、UNKNOWN_FIELD、MISSING_FIELD、SYMBOL_KEY、ACCESSOR_PROPERTY、NON_ENUMERABLE_PROPERTY、WRONG_TYPE、ARRAY_NOT_DENSE、ARRAY_EXTRA_PROPERTY。
- 識別字：INVALID_PARTICIPANT_ID、DUPLICATE_PARTICIPANT_ID、INVALID_INTERVAL_ID、DUPLICATE_INTERVAL_ID。
- 數量：PARTICIPANT_COUNT_LOW、PARTICIPANT_COUNT_HIGH、TOTAL_INTERVALS_HIGH、INTERVAL_COUNT_LOW、INTERVAL_COUNT_HIGH。
- 文字及日期：RAW_TEXT_TOO_LONG、TEXT_CONTROL_CHARACTER、TEXT_UNPAIRED_SURROGATE、NAME_EMPTY、NAME_TOO_MANY_CODEPOINTS、TIME_BASIS_EMPTY、TIME_BASIS_TOO_MANY_CODEPOINTS、DATE_FORMAT、DATE_NOT_REAL。
- 數值與區間：DURATION_FORMAT、DURATION_RANGE、START_TIME_FORMAT、START_TIME_RANGE、END_TIME_FORMAT、END_TIME_RANGE、INTERVAL_START_NOT_BEFORE_END。

驗證優先序固定為：

1. 每個 record 先檢查 prototype；錯誤回 ROOT_NOT_PLAIN_OBJECT。其後依序找第一個 unknown own string key（path 為該 record），第一個缺少的 schema key（path 為該 record），Symbol key（path 為該 record），最後依 schema 宣告順序檢查 accessor、non-enumerable 欄位及 primitive type。如此不會呼叫 getter。
2. 驗證 participants 陣列的型別／prototype、Symbol key、額外 key、密集 index 和 index descriptor，再檢查人數下限及上限。
3. 依 participant index 順序檢查其精確 record 形狀及 intervals 陣列的型別／prototype、Symbol key、額外 key、密集 index 和 index descriptor，累加各 intervals length；若總段數 >240，回 TOTAL_INTERVALS_HIGH。
4. 依 participant index 檢查每人的 1–12 段限制。此階段尚未把 row ID 放入錯誤物件。
5. 依欄位順序驗證 participant IDs 的語法和全表唯一性，再驗證 interval IDs 的語法及所屬 participant 內唯一性。遇到重複 ID 時，錯誤的該列 ID 為 null。
6. 驗證 root 的 dateRaw、timeBasisRaw、durationMinutesRaw，依此順序；再依 participant index 檢查 nameRaw，最後依 participant／interval index 檢查 startRaw、endRaw 和 start < end。
7. 字串各自先檢查 raw 256 code unit 上限，再依表列執行欄位語法／控制字／長度規則；name/timeBasis 的 unpaired surrogate 和控制碼在 trim 之前拒絕。

以上順序只決定第一個 error；不會累積多錯誤或顯示原始輸入。participants 形狀錯誤（含缺欄、錯型別、額外欄、accessor、洞）先於內容錯誤。participant row 形狀錯誤的 participantId=null；interval row 形狀錯誤的 participantId/intervalId 均為 null。

## 時間演算法

所有分鐘端點是整數，午夜為 0，24:00 為 1440。核心步驟：

1. 對每位 participant 複製、按 startMinute 再 endMinute 遞增排序。
2. 摺疊每位 participant 的區間；目前 end 與下一段 start 相等時也合併。時間窗一律半開。
3. 兩個已排序、不重疊且不相接的集合用雙指標線性求交；交集 start=max(starts)，end=min(ends)，只輸出 start<end；下一個 end 較早的一側前進，若相同則兩側皆前進。
4. 每一步輸出再排序並合併相接區間，讓連續窗口只出現一次。以所有人為必要條件，沒有參與者可被略過。
5. 計算每窗長度並以指定會議分鐘過濾，latestStartMinute=endMinute-meetingDurationMinutes。

上限固定 20 人／240 段；排序總成本不超過 O(240 log 240)，交集為各步集合長度的線性掃描。不可按分鐘展開時段、生成候選 start list、呼叫 Date 或進行多數票計分。

## 純文字報告格式

報告使用 LF 換行、沒有 BOM、沒有尾端 LF。繁中與英文固定模板如下；時間基準只插入已驗證且 trim 的純文字值，不作 Markdown/HTML 解析。結果窗口按核心排序。

繁中：

    會議空檔交集
    日期：{date}
    共同時間基準：{timeBasis}
    會議長度：{meetingDurationMinutes} 分鐘
    參與者：{participantCount} 人

    可用窗口：
    {每窗一行：{index}. {start}–{end}；可用 {durationMinutes} 分鐘；可開始 {start}–{latestStart}；最晚開始 {latestStart}}

若 windows 為空，保留「可用窗口：」標題，下一行改為「沒有足夠長的全員共同時段。」。英文標題為 Meeting overlap；其餘標籤依序為 Date、Shared time basis、Meeting length、Participants、Available windows。英文窗口格式為 {index}. {start}–{end}; {durationMinutes} available minutes; starts {start}–{latestStart}; latest start {latestStart}。英文空結果亦保留 Available windows: 標題，下一行為 No common interval fits the meeting length. 兩語均不得在最後加 LF。

## App 狀態及生命週期

App state 僅存在 app.mjs module closure：

    type AppMemory = {
      draft: MeetingDraft;
      result: MeetingResult | null;
      reportText: string | null;
      locale: Locale;
      generation: number;
      nextParticipantNumber: number;
      nextIntervalNumber: number;
    };

- 初始值由 FR-02 建立，participant IDs 為 p1/p2，interval IDs 為 s1/s2，兩個 next counters 均為 3。新增列先取用對應 counter 再遞增；刪除不回收 ID。確認清除及 BFCache reset 回到上述初始 counters。沒有 localStorage 等替代存放。
- 每次 input/change/add/remove 更新 draft 時，先清 result/reportText 並增加 generation，再更新欄位錯誤；不因 composition event 改寫原文。
- 提交時讀目前 DOM 控制值，建構精確 plain data draft；驗證成功才設 result。錯誤只設欄位 path/status 文案。同步計算小於 240 段，不建立 worker 或長時間 pending 任務。
- 「清除全部」使用頁內自製確認區，不呼叫 window.confirm 或原生 dialog；取消不改 AppMemory，確認則重建乾淨初始狀態、增 generation，重設控制項和結果。
- 語言切換連結離開前以頁內確認；接受才導航，不傳值。取消不變更狀態。
- pagehide 時同步清空 draft 欄位字串、result、reportText、錯誤及相關 DOM value，generation 遞增且兩個 ID counters 回到 3。pageshow persisted 時再建立初始 state；不恢復 BFCache 中的使用者內容。
- 不建立延遲 callback、clipboard promise、object URL、下載、history state、service worker 或任何需要額外取消 token 的生命週期。

## 安全與靜態檢查要求

- 欄位不得設定可供表單序列化的 name；使用無 action/method 表單亦不夠，MVP 不用 form submit 路徑，所有按鈕明確 type=button。JavaScript 初始化前 fieldset disabled。
- 可將使用者字串放入 input.value 或 textContent；不得使用 innerHTML、outerHTML、insertAdjacentHTML、eval、Function、URL query/hash、console、fetch、XHR、WebSocket、sendBeacon、Cookie、Storage、IndexedDB、Cache API 或 service worker。
- CSP 不允許 unsafe-inline、unsafe-eval 或外部連線；樣式和模組採同源靜態檔。Production 若加入 JSON-LD，CSP 僅以精確 hash 放行該固定 JSON-LD 內容；不得為方便而加入 inline script 全域許可。
- Check 腳本要對危險 DOM API、外部資源、未允許檔案、未閉合語法和禁止 storage/network API 給出非零退出；不能只檢查字串存在或永遠成功。測試使用假姓名／日期／地點，不需網路。
