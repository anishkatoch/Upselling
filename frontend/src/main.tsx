import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Nav from "./components/Nav";
import "./index.css";
import Dashboard from "./pages/Dashboard";
import Person from "./pages/Person";
import Recording from "./pages/Recording";
import Recordings from "./pages/Recordings";
import Team from "./pages/Team";
import UploadPage from "./pages/UploadPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <div className="shell">
        <Nav />
        <main className="content">
          <div className="page">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/recordings" element={<Recordings />} />
              <Route path="/recordings/:id" element={<Recording />} />
              <Route path="/team" element={<Team />} />
              <Route path="/team/:name" element={<Person />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  </StrictMode>,
);
