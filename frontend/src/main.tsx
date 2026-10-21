import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Nav from "./components/Nav";
import "./index.css";
import Dashboard from "./pages/Dashboard";
import Person from "./pages/Person";
import Recording from "./pages/Recording";
import Recordings from "./pages/Recordings";
import Team from "./pages/Team";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <div className="shell">
        <Nav />
        <main className="content" id="main">
          <div className="page">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/recordings" element={<Recordings />} />
              <Route path="/recordings/:id" element={<Recording />} />
              <Route path="/team" element={<Team />} />
              <Route path="/team/:name" element={<Person />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  </StrictMode>,
);
