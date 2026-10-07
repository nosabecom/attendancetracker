import "./globals.css";
import ThemeToggle from "./theme-toggle";
export const metadata = {
  title: "Rollcall · Attendance, made simple",
  description:
    "Import your class, share a QR code, and keep attendance in one place.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem('rollcall-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{}`,
          }}
        />
      </head>
      <body>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
