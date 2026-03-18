import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';

export function Layout() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 grid-bg pt-24 pb-10 px-4">
        <div className="max-w-7xl mx-auto w-full">
          <Outlet />
        </div>
      </main>
      <Footer />
    </div>
  );
}
