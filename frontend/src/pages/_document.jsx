import { Html, Head, Main, NextScript } from "next/document";

const themeScript = `(function() {
  try {
    var stored = localStorage.getItem('theme');
    var isDark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var theme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.add(theme);
    if (!isDark) {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.remove('light');
    }
  } catch (e) {}
})();`;

export default function Document() {
  return (
    <Html>
      <Head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
