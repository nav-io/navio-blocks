import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './layout/Layout';
import Home from './pages/Home';
import BlockList from './pages/BlockList';
import BlockDetail from './pages/BlockDetail';
import TxDetail from './pages/TxDetail';
import OutputDetail from './pages/OutputDetail';
import OutputList from './pages/OutputList';
import Tokens from './pages/Tokens';
import TokenDetail from './pages/TokenDetail';
import NftDetail from './pages/NftDetail';
import Network from './pages/Network';
import Price from './pages/Price';
import Supply from './pages/Supply';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/blocks" element={<BlockList />} />
          <Route path="/block/:id" element={<BlockDetail />} />
          <Route path="/tx/:txid" element={<TxDetail />} />
          <Route path="/output/:hash" element={<OutputDetail />} />
          <Route path="/outputs" element={<OutputList />} />
          <Route path="/tokens" element={<Tokens />} />
          <Route path="/token/:tokenId" element={<TokenDetail />} />
          <Route path="/nft/:tokenId/:index" element={<NftDetail />} />
          <Route path="/network" element={<Network />} />
          <Route path="/supply" element={<Supply />} />
          <Route path="/price" element={<Price />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
