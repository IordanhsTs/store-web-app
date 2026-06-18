import LoginForm from '../../LoginForm';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl shadow-xl overflow-hidden border border-gray-100 dark:border-gray-800">
        <div className="p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-xl bg-[#C5A066] flex items-center justify-center text-white font-bold text-3xl mx-auto mb-4">
              V
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">VERTEX</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-2">Σύστημα Διαχείρισης Καταστήματος</p>
          </div>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
