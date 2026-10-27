import { ConfirmProvider } from "./components/patterns/ConfirmDialog";
import React from "react";
import { createRoot } from "react-dom/client";
import { ProjectGate } from "./app/ProjectGate";
import { App } from "./app/App";
import "./style.css";
const Catalogue = import.meta.env.DEV ? React.lazy(() => import("./catalogue/Catalogue")) : null;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmProvider>{Catalogue && location.hash === "#components" ? <React.Suspense fallback="Loading catalogue…"><Catalogue /></React.Suspense> : <ProjectGate><App /></ProjectGate>}</ConfirmProvider>
  </React.StrictMode>,
);
