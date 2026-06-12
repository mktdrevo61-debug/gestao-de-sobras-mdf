import { useState, useEffect, useRef } from 'react'
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore'
import { db } from './firebase'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('chapas') // 'chapas' | 'sobras' | 'historico' | 'config'
  const [sheetsUrl, setSheetsUrl] = useState('')
  const [items, setItems] = useState([])
  const [history, setHistory] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItemId, setEditingItemId] = useState(null)
  
  const [formData, setFormData] = useState({
    itemType: 'CHAPA', color: '', length: '', width: '', thickness: '', quantity: 1, image: '', clientName: ''
  })
  
  const fileInputRef = useRef(null)

  useEffect(() => {
    // Migração robusta e segura
    const migrateData = async () => {
      try {
        const savedItems = localStorage.getItem('mdfStock')
        if (savedItems && !localStorage.getItem('migratedToFirebase')) {
           const parsed = JSON.parse(savedItems);
           for (const item of parsed) {
             await setDoc(doc(db, 'items', item.id.toString()), item);
           }
           const savedHistory = localStorage.getItem('mdfHistory')
           if (savedHistory) {
             const parsedHist = JSON.parse(savedHistory);
             for (const log of parsedHist) {
               await setDoc(doc(db, 'history', (log.id || Date.now()).toString()), { ...log, timestamp: Date.now() });
             }
           }
           const savedUrl = localStorage.getItem('sheetsUrl')
           if (savedUrl) await setDoc(doc(db, 'settings', 'global'), { sheetsUrl: savedUrl });
           
           localStorage.setItem('migratedToFirebase', 'true');
           alert("Migração dos dados locais para a Nuvem concluída com sucesso!");
        }
      } catch (err) {
        console.error("Erro de permissão no Firebase:", err);
      }
    };
    migrateData();

    // Sincronização em Tempo Real (Firebase) com Fallback
    const unsubItems = onSnapshot(collection(db, 'items'), (snapshot) => {
      const itemsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setItems(itemsList);
    }, (error) => {
      console.error("Erro Firebase Items:", error);
      alert("Acesso Negado ao Banco de Dados! Suas informações locais foram recuperadas na tela por segurança. Vá no Firebase e crie o Firestore Database no MODO DE TESTE.");
      const savedItems = localStorage.getItem('mdfStock');
      if (savedItems) setItems(JSON.parse(savedItems));
      localStorage.removeItem('migratedToFirebase'); // Permite tentar migrar de novo
    });

    const unsubHistory = onSnapshot(collection(db, 'history'), (snapshot) => {
      const historyList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      historyList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setHistory(historyList);
    }, (error) => {
      const savedHistory = localStorage.getItem('mdfHistory');
      if (savedHistory) setHistory(JSON.parse(savedHistory));
    });

    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().sheetsUrl) {
        setSheetsUrl(docSnap.data().sheetsUrl);
      }
    }, (error) => {
      const savedUrl = localStorage.getItem('sheetsUrl');
      if (savedUrl) setSheetsUrl(savedUrl);
    });

    return () => {
      unsubItems();
      unsubHistory();
      unsubSettings();
    }
  }, [])

  const logMovement = async (type, details, color) => {
    const timestamp = Date.now();
    const newLog = {
      date: new Date().toLocaleString('pt-BR'),
      timestamp,
      type, // 'ENTRADA', 'CORTE', 'SAIDA'
      color,
      details
    }
    
    // Salva na Nuvem
    await setDoc(doc(collection(db, 'history'), timestamp.toString()), newLog);

    // Continua enviando pro Sheets se configurado
    if (sheetsUrl && sheetsUrl.includes('script.google.com')) {
      fetch(sheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newLog, id: timestamp.toString() })
      }).catch(err => console.error("Erro ao enviar pro Sheets: ", err))
    }
  }

  const openModal = (itemToEdit = null) => {
    if (itemToEdit) {
      setFormData({
        itemType: itemToEdit.itemType || 'SOBRA',
        color: itemToEdit.color,
        length: itemToEdit.length,
        width: itemToEdit.width,
        thickness: itemToEdit.thickness,
        quantity: itemToEdit.quantity,
        image: itemToEdit.image || '',
        clientName: itemToEdit.clientName || ''
      })
      setEditingItemId(itemToEdit.id)
    } else {
      setFormData({ 
        itemType: activeTab === 'chapas' ? 'CHAPA' : 'SOBRA', 
        color: '', length: '', width: '', thickness: '', quantity: 1, image: '', clientName: '' 
      })
      setEditingItemId(null)
    }
    setIsModalOpen(true)
  }

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        setFormData(prev => ({...prev, image: dataUrl}));
      }
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!formData.color || !formData.length || !formData.width || !formData.thickness) return

    if (editingItemId) {
      await setDoc(doc(db, 'items', editingItemId.toString()), formData, { merge: true });
    } else {
      const newId = Date.now().toString()
      await setDoc(doc(db, 'items', newId), formData);
      
      const clientText = formData.clientName ? ` (Cliente: ${formData.clientName})` : '';
      logMovement('ENTRADA', `Adicionado ${formData.quantity} un de ${formData.length}x${formData.width}mm (${formData.thickness}mm)${clientText}`, formData.color)
    }
    
    setIsModalOpen(false)
  }

  const handleDelete = async (id) => {
    if(window.confirm('Tem certeza que deseja excluir?')) {
      const itemToDelete = items.find(i => i.id === id)
      await deleteDoc(doc(db, 'items', id.toString()))
      
      if (itemToDelete) {
        const clientText = itemToDelete.clientName ? ` (Cliente: ${itemToDelete.clientName})` : '';
        logMovement('SAIDA', `Excluído do estoque (${itemToDelete.length}x${itemToDelete.width}mm)${clientText}`, itemToDelete.color)
      }
    }
  }

  const exportToCSV = () => {
    const BOM = '\uFEFF';
    let csvRows = [];
    let fileName = '';

    if (activeTab === 'historico') {
      if (history.length === 0) return alert('Não há histórico para exportar.');
      const headers = ['Data e Hora', 'Tipo', 'Cor/Padrao', 'Detalhes'];
      csvRows = [headers.join(';')];
      history.forEach(log => {
        const row = [`"${log.date}"`, `"${log.type}"`, `"${log.color}"`, `"${log.details}"`];
        csvRows.push(row.join(';'));
      });
      fileName = 'historico-mdf.csv';
    } else {
      const targetItems = items.filter(i => {
        const type = i.itemType || 'SOBRA';
        if (activeTab === 'chapas') return type === 'CHAPA';
        if (activeTab === 'sobras') return type === 'SOBRA';
        return false;
      });
      if (targetItems.length === 0) return alert('Não há itens para exportar.');
      
      const headers = ['Cor/Padrao', 'Cliente', 'Comprimento (mm)', 'Largura (mm)', 'Espessura (mm)', 'Quantidade'];
      csvRows = [headers.join(';')];
      targetItems.forEach(item => {
        const row = [`"${item.color}"`, `"${item.clientName || ''}"`, item.length, item.width, item.thickness, item.quantity];
        csvRows.push(row.join(';'));
      });
      fileName = `${activeTab}-mdf.csv`;
    }
    
    const csvString = BOM + csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const filteredItems = items
    .filter(item => {
      const type = item.itemType || 'SOBRA';
      if (activeTab === 'chapas') return type === 'CHAPA';
      if (activeTab === 'sobras') return type === 'SOBRA';
      return false;
    })
    .filter(item => 
      item.color.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.thickness.toString().includes(searchQuery)
    )

  return (
    <div className="app-container">
      
      {/* Global Nav with Logo */}
      <nav className="global-nav">
        <div className="global-nav-content">
          <img src="./logo.png" alt="Drevo Logo" className="logo-img" />
          <span className="global-nav-title">Gestão de Sobras</span>
        </div>
      </nav>

      {/* Sidebar (Functions) */}
      <aside className="sidebar">
        <div className="sidebar-title">Módulos</div>
        <ul className="sidebar-menu">
          <li 
            className={`sidebar-link ${activeTab === 'chapas' ? 'active' : ''}`}
            onClick={() => setActiveTab('chapas')}
          >
            Chapas Novas
          </li>
          <li 
            className={`sidebar-link ${activeTab === 'sobras' ? 'active' : ''}`}
            onClick={() => setActiveTab('sobras')}
          >
            Sobras
          </li>
          <li 
            className={`sidebar-link ${activeTab === 'historico' ? 'active' : ''}`}
            onClick={() => setActiveTab('historico')}
          >
            Histórico
          </li>
          
          <div className="mobile-hide" style={{ flex: 1 }}></div>

          <li 
            className={`sidebar-link config-link ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => setActiveTab('config')}
          >
            ⚙️ Configurações
          </li>
        </ul>
      </aside>

      {/* Sub Nav */}
      <div className="sub-nav">
        <h1 className="sub-nav-title">
          {activeTab === 'chapas' && 'Estoque de Chapas Novas'}
          {activeTab === 'sobras' && 'Estoque de Sobras'}
          {activeTab === 'historico' && 'Histórico de Movimentações'}
          {activeTab === 'config' && 'Configurações'}
        </h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {(activeTab === 'chapas' || activeTab === 'sobras') && (
            <input 
              type="text" 
              className="search-input" 
              placeholder={`Buscar em ${activeTab}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          )}
          
          {(activeTab !== 'config') && (
            <button className="btn-dark-utility" style={{ backgroundColor: '#217346', color: 'white' }} onClick={exportToCSV}>
              Exportar Excel
            </button>
          )}

          {(activeTab === 'chapas' || activeTab === 'sobras') && (
            <button className="btn-primary" onClick={() => openModal()}>
              Adicionar {activeTab === 'chapas' ? 'Chapa' : 'Sobra'}
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="main-content">
        <div className="container">
          
          {(activeTab === 'chapas' || activeTab === 'sobras') && (
            filteredItems.length === 0 ? (
              <div style={{ textAlign: 'center', marginTop: '100px', color: 'var(--color-ink-muted-48)' }}>
                <p className="typography-display-lg" style={{ marginBottom: '16px' }}>Estoque Vazio.</p>
                <p>Clique em "Adicionar {activeTab === 'chapas' ? 'Chapa' : 'Sobra'}" para começar.</p>
              </div>
            ) : (
              <div className="grid">
                {filteredItems.map(item => (
                  <div key={item.id} className="mdf-card">
                    {item.image ? (
                       <img src={item.image} alt={item.color} className="mdf-card-image" />
                    ) : (
                      <div className="mdf-card-image-placeholder">
                        <div style={{ width: '60%', height: '60%', backgroundColor: 'var(--color-surface-tile-1)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '14px' }}>
                          SEM FOTO
                        </div>
                      </div>
                    )}
                    <div className="mdf-card-content">
                      <h2 className="typography-body-strong mdf-card-title">{item.color}</h2>
                      <div className="mdf-card-dimensions">
                        {item.length}mm x {item.width}mm • {item.thickness}mm
                        {item.clientName && (
                          <div style={{ marginTop: '6px', color: 'var(--color-primary)', fontWeight: '600' }}>
                            👤 Cliente: {item.clientName}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="mdf-card-quantity">{item.quantity} un</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button className="btn-dark-utility" style={{ backgroundColor: 'var(--color-canvas-parchment)', color: 'var(--color-ink)' }} onClick={() => openModal(item)}>
                            Editar
                          </button>
                          <button className="btn-dark-utility" onClick={() => handleDelete(item.id)}>
                            Excluir
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'historico' && (
            history.length === 0 ? (
              <div style={{ textAlign: 'center', marginTop: '100px', color: 'var(--color-ink-muted-48)' }}>
                <p className="typography-display-lg" style={{ marginBottom: '16px' }}>Nenhuma movimentação registrada.</p>
                <p>O histórico começará a ser preenchido quando você adicionar, cortar ou excluir sobras.</p>
              </div>
            ) : (
              <div className="history-table-container">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Data e Hora</th>
                      <th>Tipo</th>
                      <th>Cor/Padrão</th>
                      <th>Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((log) => (
                      <tr key={log.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{log.date}</td>
                        <td>
                          <span className={
                            log.type === 'ENTRADA' ? 'badge-entrada' : 
                            log.type === 'CORTE' ? 'badge-corte' : 'badge-saida'
                          }>
                            {log.type}
                          </span>
                        </td>
                        <td style={{ fontWeight: '600' }}>{log.color}</td>
                        <td>{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {activeTab === 'config' && (
            <div style={{ maxWidth: '600px', margin: '40px auto', backgroundColor: '#ffffff', padding: '32px', borderRadius: '12px', border: '1px solid var(--color-hairline)', boxShadow: '0 4px 14px rgba(0,0,0,0.05)' }}>
              <h2 className="typography-display-lg" style={{ marginBottom: '12px' }}>Sincronização com Google Sheets</h2>
              <p style={{ color: 'var(--color-ink-muted-80)', marginBottom: '24px', lineHeight: '1.5' }}>
                Conecte seu sistema a uma planilha online do Google. Para isso, cole abaixo a URL do Webhook do Google Apps Script que você gerou.
              </p>
              
              <div className="form-group">
                <label className="form-label" style={{ color: '#0071e3' }}>URL do Google Apps Script</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="https://script.google.com/macros/s/..."
                  value={sheetsUrl}
                  onChange={e => setSheetsUrl(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="modal-actions" style={{ marginTop: '32px' }}>
                <button 
                  type="button" 
                  className="btn-primary" 
                  onClick={() => {
                    setDoc(doc(db, 'settings', 'global'), { sheetsUrl });
                    alert('Conexão salva na nuvem com sucesso! Toda a equipe agora compartilha dessa planilha.');
                  }}
                >
                  Salvar Conexão
                </button>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 className="typography-display-lg modal-title">
              {editingItemId ? `Editar ${formData.itemType === 'CHAPA' ? 'Chapa' : 'Sobra'}` : `Adicionar ${formData.itemType === 'CHAPA' ? 'Chapa' : 'Sobra'}`}
            </h2>
            <form onSubmit={handleSave}>
              <div className="file-input-wrapper">
                 <label className="form-label">Foto do MDF (Opcional)</label>
                 {formData.image && (
                   <img src={formData.image} alt="Preview" style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '8px', marginBottom: '8px' }} />
                 )}
                 <input 
                   type="file" 
                   accept="image/*" 
                   className="file-input"
                   ref={fileInputRef}
                   onChange={handleImageUpload}
                 />
              </div>

              <div className="form-group">
                <label className="form-label">Cor / Padrão</label>
                <input 
                  type="text" 
                  className="form-input" 
                  required
                  placeholder="Ex: Carvalho Munique"
                  value={formData.color}
                  onChange={e => setFormData({...formData, color: e.target.value})}
                />
              </div>

              {formData.itemType === 'CHAPA' && (
                <div className="form-group">
                  <label className="form-label">Pertence a qual Cliente? (Opcional)</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Nome do cliente ou projeto"
                    value={formData.clientName || ''}
                    onChange={e => setFormData({...formData, clientName: e.target.value})}
                  />
                </div>
              )}
              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Comprimento (mm)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    required
                    value={formData.length}
                    onChange={e => setFormData({...formData, length: e.target.value})}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Largura (mm)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    required
                    value={formData.width}
                    onChange={e => setFormData({...formData, width: e.target.value})}
                  />
                </div>
              </div>

              {editingItemId && (
                <div style={{ backgroundColor: 'var(--color-canvas-parchment)', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid var(--color-hairline)' }}>
                  <label className="form-label" style={{ marginBottom: '12px', display: 'block', color: 'var(--color-primary)' }}>✂️ Corte Rápido (Subtração)</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Quem pediu o corte? (Cliente/Funcionário)"
                      style={{ flex: '1', minWidth: '200px' }}
                      id="cutRequesterInput"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input 
                      type="number" 
                      className="form-input" 
                      placeholder="Medida cortada (mm)"
                      style={{ flex: '1', minWidth: '150px' }}
                      id="cutAmountInput"
                    />
                    <button 
                      type="button" 
                      className="btn-dark-utility" 
                      style={{ backgroundColor: 'var(--color-ink-muted-80)' }}
                      onClick={async () => {
                        const input = document.getElementById('cutAmountInput');
                        const requesterInput = document.getElementById('cutRequesterInput');
                        const cut = Number(input.value);
                        const requester = requesterInput.value ? ` (Pedido por: ${requesterInput.value})` : '';
                        if (cut > 0 && formData.length) {
                          const newLength = Math.max(0, formData.length - cut);
                          setFormData({...formData, length: newLength});
                          if (editingItemId) {
                            await setDoc(doc(db, 'items', editingItemId.toString()), { length: newLength }, { merge: true });
                          }
                          logMovement('CORTE', `Cortado ${cut}mm do Comprimento${requester}`, formData.color);
                          input.value = '';
                          requesterInput.value = '';
                        }
                      }}
                    >
                      - Comprimento
                    </button>
                    <button 
                      type="button" 
                      className="btn-dark-utility" 
                      style={{ backgroundColor: 'var(--color-ink-muted-80)' }}
                      onClick={async () => {
                        const input = document.getElementById('cutAmountInput');
                        const requesterInput = document.getElementById('cutRequesterInput');
                        const cut = Number(input.value);
                        const requester = requesterInput.value ? ` (Pedido por: ${requesterInput.value})` : '';
                        if (cut > 0 && formData.width) {
                          const newWidth = Math.max(0, formData.width - cut);
                          setFormData({...formData, width: newWidth});
                          if (editingItemId) {
                            await setDoc(doc(db, 'items', editingItemId.toString()), { width: newWidth }, { merge: true });
                          }
                          logMovement('CORTE', `Cortado ${cut}mm da Largura${requester}`, formData.color);
                          input.value = '';
                          requesterInput.value = '';
                        }
                      }}
                    >
                      - Largura
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Espessura (mm)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    required
                    placeholder="Ex: 15"
                    value={formData.thickness}
                    onChange={e => setFormData({...formData, thickness: e.target.value})}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Quantidade</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    min="1"
                    required
                    value={formData.quantity}
                    onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 1})}
                  />
                </div>
              </div>
              
              <div className="modal-actions">
                <button type="button" className="btn-ghost-pill" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {editingItemId ? 'Atualizar' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
