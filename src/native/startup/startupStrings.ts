/**
 * Words of the desktop shell itself (start-up window, the page shown when
 * Zrzur cannot be reached, tray menu), in seven languages. The web client has its own catalogs; these are
 * the few lines shown before it is loaded or outside its window.
 *
 * Arabic is Modern Standard Arabic. Language = the one chosen in the app
 * (once the app has told the shell), else the device's, else English. Words
 * the web client also has (Retry, Details, Close, Minimise, Source code)
 * are the web client's own.
 */
import type { StartupState } from "./startupFlow";

/** The seven languages the app itself is complete in (web catalogs) */
export const SHELL_LOCALES = [
  "en",
  "ar",
  "de",
  "fr",
  "es",
  "ru",
  "zh-Hans",
] as const;
export type ShellLocale = (typeof SHELL_LOCALES)[number];

/**
 * The shell language for a language tag: "ar-SY" -> "ar", "de-AT" -> "de",
 * "es-419" -> "es". A Chinese device reports a region or the bare language
 * ("zh-CN", "zh"), never the script: those are Simplified Chinese, as in the
 * web client (browserPreferredLanguage). Traditional Chinese ("zh-TW",
 * "zh-HK", "zh-Hant") and every other language get English.
 */
export function shellLocale(tag: string | undefined): ShellLocale {
  const wanted = (tag ?? "").trim().replace(/_/g, "-");
  if (/^zh(-(CN|SG|Hans(-.*)?))?$/i.test(wanted)) return "zh-Hans";
  const language = wanted.toLowerCase().split("-")[0];
  return language !== "zh" &&
    (SHELL_LOCALES as readonly string[]).includes(language)
    ? (language as ShellLocale)
    : "en";
}

/** Every text of the shell; test/startup.test.mjs fails when a language lacks one */
export const STRINGS = {
  en: {
    name: "Zrzur",
    checking: "Checking for updates…",
    downloading: "Downloading update",
    version: "Version {v}",
    bytes: "{a} of {b} MB",
    installing: "Installing update…",
    installingSub: "Zrzur restarts by itself when this is done.",
    opening: "Opening Zrzur…",
    offline: "No internet connection",
    offlineSub: "Zrzur opens without checking for updates.",
    failed: "The update could not be installed",
    failedSub: "Zrzur opens with the version you have.",
    open: "Open Zrzur",
    retry: "Try again",
    details: "Details",
    unreachable: "Zrzur cannot be reached right now",
    unreachableSub: "Zrzur keeps trying and opens by itself as soon as it can.",
    noNetwork: "No internet connection",
    noNetworkSub: "Zrzur opens by itself when the connection is back.",
    retryNow: "Try now",
    minimise: "Minimise",
    close: "Close",
    trayTitle: "Zrzur",
    trayVersion: "Version",
    trayAbout: "About Zrzur",
    traySource: "Source code",
    trayShow: "Show Zrzur",
    trayHide: "Hide Zrzur",
    trayQuit: "Quit Zrzur",
    addToDictionary: "Add to dictionary",
    badgeNone: "No notifications",
    badgeUnread: "Unread messages",
    badgeCount: "{n} notifications",
  },
  ar: {
    name: "زرزور",
    checking: "جارٍ البحث عن تحديثات…",
    downloading: "جارٍ تنزيل التحديث",
    version: "الإصدار {v}",
    bytes: "{a} من {b} ميغابايت",
    installing: "جارٍ تثبيت التحديث…",
    installingSub: "سيُعاد تشغيل زرزور تلقائيًا عند الانتهاء.",
    opening: "جارٍ فتح زرزور…",
    offline: "لا يوجد اتصال بالإنترنت",
    offlineSub: "سيُفتح زرزور دون البحث عن تحديثات.",
    failed: "تعذّر تثبيت التحديث",
    failedSub: "سيُفتح زرزور بالإصدار الموجود لديك.",
    open: "فتح زرزور",
    retry: "إعادة المحاولة",
    details: "التفاصيل",
    unreachable: "يتعذّر الوصول إلى زرزور الآن",
    unreachableSub: "يواصل زرزور المحاولة وسيُفتح تلقائيًا فور نجاح الاتصال.",
    noNetwork: "لا يوجد اتصال بالإنترنت",
    noNetworkSub: "سيُفتح زرزور تلقائيًا عند عودة الاتصال.",
    retryNow: "المحاولة الآن",
    minimise: "تصغير",
    close: "إغلاق",
    trayTitle: "زرزور",
    trayVersion: "الإصدار",
    trayAbout: "حول زرزور",
    traySource: "الشيفرة المصدرية",
    trayShow: "إظهار زرزور",
    trayHide: "إخفاء زرزور",
    trayQuit: "إنهاء زرزور",
    addToDictionary: "إضافة إلى القاموس",
    badgeNone: "لا إشعارات",
    badgeUnread: "رسائل غير مقروءة",
    badgeCount: "الإشعارات: {n}",
  },
  de: {
    name: "Zrzur",
    checking: "Suche nach Updates …",
    downloading: "Update wird heruntergeladen",
    version: "Version {v}",
    bytes: "{a} von {b} MB",
    installing: "Update wird installiert …",
    installingSub: "Zrzur startet danach von selbst neu.",
    opening: "Zrzur wird geöffnet …",
    offline: "Keine Internetverbindung",
    offlineSub: "Zrzur wird ohne Update-Prüfung geöffnet.",
    failed: "Das Update konnte nicht installiert werden",
    failedSub: "Zrzur wird mit der vorhandenen Version geöffnet.",
    open: "Zrzur öffnen",
    retry: "Erneut versuchen",
    details: "Details",
    unreachable: "Zrzur ist gerade nicht erreichbar",
    unreachableSub:
      "Zrzur versucht es weiter und öffnet sich von selbst, sobald es geht.",
    noNetwork: "Keine Internetverbindung",
    noNetworkSub:
      "Zrzur öffnet sich von selbst, sobald die Verbindung wieder da ist.",
    retryNow: "Jetzt versuchen",
    minimise: "Minimieren",
    close: "Schließen",
    trayTitle: "Zrzur",
    trayVersion: "Version",
    trayAbout: "Über Zrzur",
    traySource: "Quellcode",
    trayShow: "Zrzur anzeigen",
    trayHide: "Zrzur ausblenden",
    trayQuit: "Zrzur beenden",
    addToDictionary: "Zum Wörterbuch hinzufügen",
    badgeNone: "Keine Benachrichtigungen",
    badgeUnread: "Ungelesene Nachrichten",
    badgeCount: "{n} Benachrichtigungen",
  },
  fr: {
    name: "Zrzur",
    checking: "Recherche de mises à jour…",
    downloading: "Téléchargement de la mise à jour",
    version: "Version {v}",
    bytes: "{a} sur {b} Mo",
    installing: "Installation de la mise à jour…",
    installingSub:
      "Zrzur redémarrera tout seul une fois l’installation terminée.",
    opening: "Ouverture de Zrzur…",
    offline: "Pas de connexion Internet",
    offlineSub: "Zrzur s’ouvre sans rechercher de mises à jour.",
    failed: "La mise à jour n’a pas pu être installée",
    failedSub: "Zrzur s’ouvre avec la version que vous avez.",
    open: "Ouvrir Zrzur",
    retry: "Réessayer",
    details: "Détails",
    unreachable: "Zrzur est injoignable pour le moment",
    unreachableSub:
      "Zrzur réessaie tout seul et s’ouvre dès que c’est possible.",
    noNetwork: "Pas de connexion Internet",
    noNetworkSub: "Zrzur s’ouvre tout seul dès que la connexion revient.",
    retryNow: "Réessayer maintenant",
    minimise: "Réduire",
    close: "Fermer",
    trayTitle: "Zrzur",
    trayVersion: "Version",
    trayAbout: "À propos de Zrzur",
    traySource: "Code source",
    trayShow: "Afficher Zrzur",
    trayHide: "Masquer Zrzur",
    trayQuit: "Quitter Zrzur",
    addToDictionary: "Ajouter au dictionnaire",
    badgeNone: "Aucune notification",
    badgeUnread: "Messages non lus",
    badgeCount: "Notifications : {n}",
  },
  es: {
    name: "Zrzur",
    checking: "Buscando actualizaciones…",
    downloading: "Descargando la actualización",
    version: "Versión {v}",
    bytes: "{a} de {b} MB",
    installing: "Instalando la actualización…",
    installingSub: "Zrzur se reiniciará solo al terminar.",
    opening: "Abriendo Zrzur…",
    offline: "Sin conexión a Internet",
    offlineSub: "Zrzur se abre sin buscar actualizaciones.",
    failed: "No se pudo instalar la actualización",
    failedSub: "Zrzur se abre con la versión que tienes.",
    open: "Abrir Zrzur",
    retry: "Reintentar",
    details: "Detalles",
    unreachable: "No se puede conectar con Zrzur ahora",
    unreachableSub:
      "Zrzur sigue intentándolo y se abrirá solo en cuanto pueda.",
    noNetwork: "Sin conexión a Internet",
    noNetworkSub: "Zrzur se abrirá solo cuando vuelva la conexión.",
    retryNow: "Reintentar ahora",
    minimise: "Minimizar",
    close: "Cerrar",
    trayTitle: "Zrzur",
    trayVersion: "Versión",
    trayAbout: "Acerca de Zrzur",
    traySource: "Código fuente",
    trayShow: "Mostrar Zrzur",
    trayHide: "Ocultar Zrzur",
    trayQuit: "Salir de Zrzur",
    addToDictionary: "Añadir al diccionario",
    badgeNone: "Sin notificaciones",
    badgeUnread: "Mensajes sin leer",
    badgeCount: "Notificaciones: {n}",
  },
  ru: {
    name: "Zrzur",
    checking: "Проверка обновлений…",
    downloading: "Загрузка обновления",
    version: "Версия {v}",
    bytes: "{a} из {b} МБ",
    installing: "Установка обновления…",
    installingSub: "Zrzur перезапустится сам, когда всё будет готово.",
    opening: "Zrzur открывается…",
    offline: "Нет подключения к интернету",
    offlineSub: "Zrzur откроется без проверки обновлений.",
    failed: "Не удалось установить обновление",
    failedSub: "Zrzur откроется с текущей версией.",
    open: "Открыть Zrzur",
    retry: "Повторить",
    details: "Подробности",
    unreachable: "Zrzur сейчас недоступен",
    unreachableSub:
      "Zrzur продолжает попытки и откроется сам, как только сможет.",
    noNetwork: "Нет подключения к интернету",
    noNetworkSub: "Zrzur откроется сам, когда связь вернётся.",
    retryNow: "Повторить сейчас",
    minimise: "Свернуть",
    close: "Закрыть",
    trayTitle: "Zrzur",
    trayVersion: "Версия",
    trayAbout: "О Zrzur",
    traySource: "Исходный код",
    trayShow: "Показать Zrzur",
    trayHide: "Скрыть Zrzur",
    trayQuit: "Выйти из Zrzur",
    addToDictionary: "Добавить в словарь",
    badgeNone: "Нет уведомлений",
    badgeUnread: "Непрочитанные сообщения",
    badgeCount: "Уведомления: {n}",
  },
  "zh-Hans": {
    name: "Zrzur",
    checking: "正在检查更新…",
    downloading: "正在下载更新",
    version: "版本 {v}",
    bytes: "{a} / {b} MB",
    installing: "正在安装更新…",
    installingSub: "完成后 Zrzur 会自动重新启动。",
    opening: "正在打开 Zrzur…",
    offline: "没有网络连接",
    offlineSub: "Zrzur 将直接打开，不检查更新。",
    failed: "无法安装更新",
    failedSub: "Zrzur 将以现有版本打开。",
    open: "打开 Zrzur",
    retry: "重试",
    details: "详情",
    unreachable: "暂时无法连接到 Zrzur",
    unreachableSub: "Zrzur 会继续尝试，连上后自动打开。",
    noNetwork: "没有网络连接",
    noNetworkSub: "网络恢复后 Zrzur 会自动打开。",
    retryNow: "立即重试",
    minimise: "最小化",
    close: "关闭",
    trayTitle: "Zrzur",
    trayVersion: "版本",
    trayAbout: "关于 Zrzur",
    traySource: "源代码",
    trayShow: "显示 Zrzur",
    trayHide: "隐藏 Zrzur",
    trayQuit: "退出 Zrzur",
    addToDictionary: "添加到词典",
    badgeNone: "没有通知",
    badgeUnread: "有未读消息",
    badgeCount: "{n} 条通知",
  },
} as const;

export type ShellStringKey = keyof (typeof STRINGS)["en"];

export function shellString(locale: ShellLocale, key: ShellStringKey): string {
  return STRINGS[locale][key];
}

/** "26.1.0-beta.2" -> "26.1.0 Beta 2" (the way the product writes it) */
export function displayVersion(version: string): string {
  const match = /^v?(\d+\.\d+\.\d+)(?:-([A-Za-z]+)\.?(\d+)?)?$/.exec(version);
  if (!match) return version;
  if (!match[2]) return match[1];
  const word = match[2][0].toUpperCase() + match[2].slice(1).toLowerCase();
  return `${match[1]} ${word}${match[3] ? ` ${match[3]}` : ""}`;
}

/** Megabytes with one decimal, in the language's own decimal mark, Western digits */
function megabytes(bytes: number, locale: ShellLocale): string {
  return new Intl.NumberFormat(locale === "ar" ? "en" : locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(bytes / 1_000_000);
}

/** The whole percentage of bytes received; 100 only when every byte is there */
export function percent(received: number, total: number): number {
  if (!(total > 0) || !(received > 0)) return 0;
  if (received >= total) return 100;
  return Math.min(99, Math.floor((received / total) * 100));
}

/** "45%", "45 %" or "%45": the percentage the way the language writes it */
export function percentLabel(value: number, locale: ShellLocale): string {
  return new Intl.NumberFormat(locale === "ar" ? "en" : locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

/** What the start-up page draws: ready-made words, nothing to translate there */
export interface StartupView {
  kind: StartupState["kind"];
  dir: "rtl" | "ltr";
  lang: ShellLocale;
  name: string;
  version: string;
  /** The logo glides only while work is really running */
  moving: boolean;
  tone: "" | "warn" | "error";
  title: string;
  sub: string;
  /** percent: the number (bar width); label: written the language's way */
  progress?: { percent: number; label: string; bytes: string };
  failed?: { open: string; retry: string; details: string; text: string };
}

export function startupView(
  state: StartupState,
  locale: ShellLocale,
  appVersion: string,
): StartupView {
  const t = (key: ShellStringKey) => STRINGS[locale][key];
  const view: StartupView = {
    kind: state.kind,
    dir: locale === "ar" ? "rtl" : "ltr",
    lang: locale,
    name: t("name"),
    version: displayVersion(appVersion),
    moving: true,
    tone: "",
    title: "",
    sub: "",
  };
  switch (state.kind) {
    case "checking":
      view.title = t("checking");
      break;
    case "downloading":
      view.title = t("downloading");
      view.sub = t("version").replace("{v}", displayVersion(state.version));
      view.progress = {
        percent: percent(state.received, state.total),
        label: percentLabel(percent(state.received, state.total), locale),
        bytes: t("bytes")
          .replace("{a}", megabytes(state.received, locale))
          .replace("{b}", megabytes(state.total, locale)),
      };
      break;
    case "installing":
      view.title = t("installing");
      view.sub = t("installingSub");
      break;
    case "opening":
      view.title = t("opening");
      break;
    case "offline":
      view.title = t("offline");
      view.sub = t("offlineSub");
      view.moving = false;
      view.tone = "warn";
      break;
    case "failed":
      view.title = t("failed");
      view.sub = t("failedSub");
      view.moving = false;
      view.tone = "error";
      view.failed = {
        open: t("open"),
        retry: t("retry"),
        details: t("details"),
        text: state.details,
      };
      break;
  }
  return view;
}
