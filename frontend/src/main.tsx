import { MotionConfig } from "framer-motion";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AnimatedRoutes from "./components/AnimatedRoutes";
import Nav from "./components/Nav";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
    <BrowserRouter>
      <div className="shell">
        <Nav />
        <main className="content" id="main">
          <div className="page">
            <AnimatedRoutes />
          </div>
        </main>
      </div>
    </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);
