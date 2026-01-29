
// ========== INVENTORY MOVEMENTS & STATS ==========

// Get inventory movements (almoxarifado tab Movimentacoes)
app.get("/inventory/movements", requireAuth, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const result = await pool.query(
      `SELECT m.*, i.name as item_name, i.sku, i.category
       FROM inventory_movements m
       LEFT JOIN inventory_items i ON m.item_id = i.id
       WHERE m.key_id = $1
       AND ($2::date IS NULL OR m.created_at >= $2::date)
       AND ($3::date IS NULL OR m.created_at <= $3::date + interval '1 day')
       ORDER BY m.created_at DESC
       LIMIT 500`,
      [req.user.keyId, start_date || null, end_date || null]
    );
    res.json({ ok: true, movements: result.rows });
  } catch (error) {
    console.error("Error fetching movements:", error);
    res.status(500).json({ ok: false, error: "Erro ao buscar movimentacoes" });
  }
});

// Create inventory movement
app.post("/inventory/movements", requireAuth, requireRoles(["almoxarifado"]), async (req, res) => {
  try {
    const { item_id, movement_type, quantity, usage_type, person_name, person_sector, notes } = req.body;
    const id = crypto.randomUUID();
    
    // Insert movement
    await pool.query(
      `INSERT INTO inventory_movements (id, item_id, movement_type, quantity, usage_type, person_name, person_sector, notes, created_by, key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, item_id, movement_type, quantity, usage_type || null, person_name || null, person_sector || null, notes || null, req.user.id, req.user.keyId]
    );
    
    // Update inventory quantity
    if (movement_type === "entrada") {
      await pool.query("UPDATE inventory_items SET quantity = quantity + $1 WHERE id = $2", [quantity, item_id]);
    } else if (movement_type === "saida") {
      await pool.query("UPDATE inventory_items SET quantity = quantity - $1 WHERE id = $2", [quantity, item_id]);
      
      // If emprestimo, create a loan record too
      if (usage_type === "emprestimo") {
        const loanId = crypto.randomUUID();
        await pool.query(
          `INSERT INTO inventory_loans (id, item_id, quantity, borrowed_by, borrowed_by_name, notes, key_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [loanId, item_id, quantity, req.user.id, person_name, notes, req.user.keyId]
        );
      }
    }
    
    res.json({ ok: true, message: "Movimentacao registrada" });
  } catch (error) {
    console.error("Error creating movement:", error);
    res.status(500).json({ ok: false, error: "Erro ao registrar movimentacao" });
  }
});

// Return movement (devolucao)
app.post("/inventory/movements/:id/return", requireAuth, requireRoles(["almoxarifado"]), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get movement info
    const mov = await pool.query("SELECT * FROM inventory_movements WHERE id = $1", [id]);
    if (mov.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Movimentacao nao encontrada" });
    }
    
    const movement = mov.rows[0];
    
    // Mark as returned
    await pool.query("UPDATE inventory_movements SET is_returned = true, returned_at = NOW() WHERE id = $1", [id]);
    
    // Return quantity to inventory
    await pool.query("UPDATE inventory_items SET quantity = quantity + $1 WHERE id = $2", [movement.quantity, movement.item_id]);
    
    res.json({ ok: true, message: "Item devolvido com sucesso" });
  } catch (error) {
    console.error("Error returning movement:", error);
    res.status(500).json({ ok: false, error: "Erro ao devolver item" });
  }
});

// Get pending loans
app.get("/inventory/loans/pending", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.*, i.name as item_name, i.sku, i.category
       FROM inventory_loans l
       LEFT JOIN inventory_items i ON l.item_id = i.id
       WHERE l.key_id = $1 AND l.returned_at IS NULL
       ORDER BY l.created_at DESC`,
      [req.user.keyId]
    );
    res.json({ ok: true, loans: result.rows });
  } catch (error) {
    console.error("Error fetching pending loans:", error);
    res.status(500).json({ ok: false, error: "Erro ao buscar emprestimos" });
  }
});

// Get inventory stats
app.get("/inventory/stats", requireAuth, async (req, res) => {
  try {
    const { period } = req.query;
    
    let dateFilter = "";
    if (period === "week") {
      dateFilter = "AND m.created_at >= NOW() - interval '7 days'";
    } else if (period === "month") {
      dateFilter = "AND m.created_at >= NOW() - interval '30 days'";
    }
    
    const stats = await pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE movement_type = 'entrada') as total_entradas,
         COUNT(*) FILTER (WHERE movement_type = 'saida') as total_saidas,
         COUNT(*) FILTER (WHERE usage_type = 'emprestimo' AND is_returned = false) as pendentes,
         COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'entrada'), 0) as qty_entradas,
         COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'saida'), 0) as qty_saidas
       FROM inventory_movements m
       WHERE key_id = $1 ${dateFilter}`,
      [req.user.keyId]
    );
    
    res.json({ ok: true, stats: stats.rows[0] });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ ok: false, error: "Erro ao buscar estatisticas" });
  }
});
