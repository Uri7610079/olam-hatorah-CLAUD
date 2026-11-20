import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import App from "./App";
import "./index.css";

// אזור ראשי הקבוצות (/portal) נטען בנפרד ולפני מסך הכניסה של המשרד: ראש
// קבוצה אינו משתמש של המערכת, ואסור שיגיע למסך הכניסה שלה או לתפריט שלה.
const PortalApp = React.lazy(() => import("./portal/PortalApp"));
const isPortal = window.location.pathname === "/portal" || window.location.pathname.startsWith("/portal/");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPortal ? (
      <Suspense fallback={null}>
        <PortalApp />
      </Suspense>
    ) : (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    )}
  </React.StrictMode>,
);
