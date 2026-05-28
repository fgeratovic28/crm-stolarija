import { useState, useEffect } from "react";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function AppLayout({ children, title }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (title) {
      document.title = `${title} | Termo Plast CRM`;
    } else {
      document.title = "Termo Plast CRM";
    }
  }, [title]);

  return (
    <div className="min-h-screen flex bg-background overflow-x-hidden">
      <AppSidebar
        open={sidebarOpen}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <AppHeader
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onMobileMenuToggle={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        />
        <main className="flex-1 p-4 sm:p-5 md:p-7 overflow-auto leading-relaxed">
          {children}
        </main>
      </div>
    </div>
  );
}
