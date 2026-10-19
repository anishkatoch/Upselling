import Upload from "../components/Upload";

export default function UploadPage() {
  return (
    <>
      <div className="head">
        <h1>Upload a recording</h1>
        <p className="sub">Audio or video, any length. We&apos;ll tell you who said what and whether an upsell was tried.</p>
      </div>
      <Upload />
    </>
  );
}
