require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const app = express();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static('public'));

// --- PACIENTES ---

// Buscar pacientes: Ahora incluye Apellido_Materno para que el buscador sea más preciso
app.get('/buscar-paciente', async (req, res) => {
    const { consulta } = req.query;
    const { data, error } = await supabase
        .from('Pacientes')
        .select('*') // Mantenemos el '*' para que el frontend reciba las alertas de alergias
        .or(`Nombre.ilike.%${consulta}%,Apellido_Paterno.ilike.%${consulta}%,Apellido_Materno.ilike.%${consulta}%`)
        .order('Nombre', { ascending: true }); // Ordenado alfabéticamente
        
    if (error) return res.status(400).json(error);
    res.json(data || []);
});

// Registrar Paciente: Aseguramos que acepte los nuevos campos de antecedentes
app.post('/agregar-paciente', async (req, res) => {
    // Usamos req.body directamente ya que el frontend envía los nombres de campos exactos
    const { error } = await supabase.from('Pacientes').insert([req.body]);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Registrado" });
});

// Actualizar Ficha: Permite corregir alergias o antecedentes desde el panel
app.put('/actualizar-paciente/:id', async (req, res) => {
    const { error } = await supabase
        .from('Pacientes')
        .update(req.body)
        .eq('id', req.params.id);
        
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Actualizado" });
});

app.delete('/eliminar-paciente/:id', async (req, res) => {
    const { error } = await supabase.from('Pacientes').delete().eq('id', req.params.id);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Eliminado" });
});

// --- EVOLUCIÓN ---

app.get('/datos-paciente/:id', async (req, res) => {
    const { data, error } = await supabase.from('Pacientes').select('*').eq('id', req.params.id).single();
    if (error) return res.status(400).json(error);
    res.json(data);
});

// Obtener historial con imágenes (Relación con tabla Imagenes_Evolucion)
app.get('/historial-paciente/:id', async (req, res) => {
    const { data, error } = await supabase.from('Evolucion')
        .select('*, Imagenes_Evolucion(url_imagen)')
        .eq('id', req.params.id)
        .order('fecha', { ascending: false });
    if (error) return res.status(400).json(error);
    res.json(data || []);
});

app.delete('/eliminar-nota/:id_nota', async (req, res) => {
    const { error } = await supabase.from('Evolucion').delete().eq('id_nota', req.params.id_nota);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Nota eliminada" });
});

// Actualizar nota existente
app.put('/actualizar-nota/:id_nota', upload.array('imagenes', 5), async (req, res) => {
    try {
        const { error: updErr } = await supabase.from('Evolucion').update({
            fecha: req.body.fecha,
            motivo_consulta: req.body.motivo_consulta,
            escala_dolor: parseInt(req.body.escala_dolor) || 0,
            nota_evolucion: req.body.nota_evolucion,
            hallazgos_eco: req.body.hallazgos_eco,
            hallazgos_rx: req.body.hallazgos_rx,
            recomendaciones: req.body.recomendaciones,
            proxima_cita: req.body.proxima_cita
        }).eq('id_nota', req.params.id_nota);

        if (updErr) throw updErr;
        res.json({ mensaje: "Actualizado" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Guardar nueva nota de evolución con soporte para imágenes de ultrasonido/Rx
app.post('/agregar-evolucion', upload.array('imagenes', 5), async (req, res) => {
    const body = req.body;
    try {
        // 1. Insertar la nota técnica
        const { data: nota, error: notaErr } = await supabase.from('Evolucion').insert([{
            id: parseInt(body.id),
            fecha: body.fecha,
            motivo_consulta: body.motivo_consulta,
            escala_dolor: parseInt(body.escala_dolor) || 0,
            nota_evolucion: body.nota_evolucion,
            hallazgos_eco: body.hallazgos_eco,
            hallazgos_rx: body.hallazgos_rx,
            recomendaciones: body.recomendaciones,
            proxima_cita: body.proxima_cita
        }]).select('id_nota').single();

        if (notaErr) throw notaErr;

        // 2. Si hay imágenes, subirlas al Storage y guardar la referencia
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const nombre = `${Date.now()}-${file.originalname}`;
                await supabase.storage.from('imagenes_evolucion').upload(nombre, file.buffer, { contentType: file.mimetype });
                
                const { data: urlData } = supabase.storage.from('imagenes_evolucion').getPublicUrl(nombre);
                await supabase.from('Imagenes_Evolucion').insert([{ 
                    id_nota: nota.id_nota, 
                    url_imagen: urlData.publicUrl 
                }]);
            }
        }
        res.json({ mensaje: "Guardado" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 FisioCid listo en puerto ${PORT} | Lic. Cristian Cid`));