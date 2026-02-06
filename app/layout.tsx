import type { Metadata } from "next";
import "./globals.css";
import UiChrome from "./_components/UiChrome";
import { UiPrefsProvider } from "./_lib/uiPrefs";

export const metadata: Metadata = {
  title: "VulnCheckList Dashboard",
  description: "Run VulnCheckList and review results.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <UiPrefsProvider>
          <UiChrome />
          <div className="app-shell">{children}</div>
        </UiPrefsProvider>
      </body>
    </html>
  );
}
