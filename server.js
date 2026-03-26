require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const app = express();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static('public'));

// --- RUTAS DE PACIENTES (PANEL DE CONTROL) ---

app.get('/buscar-paciente', async (req, res) => {
    const { consulta } = req.query;
    const { data, error } = await supabase
        .from('Pacientes')
        .select('*')
        .or(`Nombre.ilike.%${consulta}%,Apellido_Paterno.ilike.%${consulta}%,Apellido_Materno.ilike.%${consulta}%`)
        .order('Nombre', { ascending: true });
    if (error) return res.status(400).json(error);
    res.json(data || []);
});

app.get('/datos-paciente/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('Pacientes')
        .select('Nombre, Apellido_Paterno, Apellido_Materno')
        .eq('id', id)
        .single();
    if (error) return res.status(400).json(error);
    res.json(data);
});

app.post('/agregar-paciente', async (req, res) => {
    const { error } = await supabase.from('Pacientes').insert([req.body]);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Registrado" });
});

app.put('/actualizar-paciente/:id', async (req, res) => {
    const { error } = await supabase.from('Pacientes').update(req.body).eq('id', req.params.id);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Actualizado" });
});

// --- RUTAS DE RECEPCIÓN Y CITAS ---

app.post('/verificar-llegada', async (req, res) => {
    const { nombre, telefono } = req.body;
    const { data, error } = await supabase
        .from('Pacientes')
        .select('Nombre')
        .eq('Telefono', telefono)
        .ilike('Nombre', `%${nombre}%`)
        .limit(1);
    if (error || !data || data.length === 0) return res.status(404).json({ mensaje: "No encontrado" });
    res.json({ nombre: data[0].Nombre });
});

app.get('/horarios-ocupados', async (req, res) => {
    const { fecha } = req.query;
    const { data, error } = await supabase
        .from('Pacientes')
        .select('proxima_cita')
        .filter('proxima_cita', 'ilike', `${fecha}%`);
    if (error) return res.status(400).json([]);
    const ocupados = data.map(d => d.proxima_cita ? d.proxima_cita.split(' ')[1] : null).filter(h => h);
    res.json(ocupados);
});

app.post('/agendar-cita-recepcion', async (req, res) => {
    const { nombre, telefono, fecha, hora } = req.body;
    const { data: pac } = await supabase.from('Pacientes').select('id').eq('Telefono', telefono).ilike('Nombre', `%${nombre}%`).single();
    if (!pac) return res.status(404).json({ error: "Paciente no registrado" });
    const { error } = await supabase.from('Pacientes').update({ proxima_cita: `${fecha} ${hora}` }).eq('id', pac.id);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Cita agendada" });
});

// --- EVOLUCIÓN (ULTRASONIDO/NOTAS) ---

app.get('/historial-paciente/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('Evolucion')
        .select('*')
        .eq('id', id)
        .order('fecha', { ascending: false });
    if (error) return res.status(400).json(error);
    res.json(data || []);
});

app.post('/agregar-evolucion', upload.array('imagenes', 5), async (req, res) => {
    const body = req.body;
    try {
        const { data: nota, error: nErr } = await supabase.from('Evolucion').insert([{
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
        if (nErr) throw nErr;
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const nombre = `${Date.now()}-${file.originalname}`;
                await supabase.storage.from('imagenes_evolucion').upload(nombre, file.buffer, { contentType: file.mimetype });
                const { data: url } = supabase.storage.from('imagenes_evolucion').getPublicUrl(nombre);
                await supabase.from('Imagenes_Evolucion').insert([{ id_nota: nota.id_nota, url_imagen: url.publicUrl }]);
            }
        }
        res.json({ mensaje: "Guardado" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/actualizar-nota/:id', upload.array('imagenes', 5), async (req, res) => {
    const { id } = req.params;
    const body = req.body;
    const { error } = await supabase.from('Evolucion').update({
        fecha: body.fecha,
        motivo_consulta: body.motivo_consulta,
        escala_dolor: parseInt(body.escala_dolor),
        nota_evolucion: body.nota_evolucion,
        hallazgos_eco: body.hallazgos_eco,
        hallazgos_rx: body.hallazgos_rx,
        recomendaciones: body.recomendaciones,
        proxima_cita: body.proxima_cita
    }).eq('id_nota', id);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Actualizado" });
});

app.delete('/eliminar-nota/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('Evolucion').delete().eq('id_nota', id);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Eliminado" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 FisioCid listo en puerto ${PORT} | Lic. Cristian Cid`));