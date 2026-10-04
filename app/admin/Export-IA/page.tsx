"use client";

export default function ExportIAPage() {
  const exportIA = async () => {
    const response = await fetch("/api/Export-IA");

    if (!response.ok) {
      throw new Error("Erreur export");
    }

    const blob = await response.blob();

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = "POLYNOV_AI_CONTEXT.txt";

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold mb-4">
          🧠 Export IA
        </h1>

        <p className="mb-6 text-gray-600">
          Génère un contexte complet du projet.
        </p>

        <button
          onClick={exportIA}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Générer POLYNOV_AI_CONTEXT.txt
        </button>
      </div>
    </div>
  );
}