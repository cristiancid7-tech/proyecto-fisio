require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const app = express();

// Conexión a Supabase usando las variables de entorno de Render
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static('public'));

// BUSCAR PACIENTE (Nombre + Apellidos)
app.get('/buscar-paciente', async (req, res) => {
    const { consulta } = req.query;
    const { data, error } = await supabase
        .from('Pacientes')
        .select('*')
        .or(`Nombre.ilike.%${consulta}%,Apellido_Paterno.ilike.%${consulta}%,Apellido_Materno.ilike.%${consulta}%`);
    if (error) return res.status(400).json(error);
    res.json(data || []);
});

// DATOS BÁSICOS
app.get('/datos-paciente/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('Pacientes')
        .select('Nombre, Apellido_Paterno, Apellido_Materno')
        .eq('id', id)
        .single();
    if (error) return res.status(404).json({ error: "No encontrado" });
    res.json(data);
});

// HISTORIAL CON IMÁGENES
app.get('/historial-paciente/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('Evolucion')
        .select('*, Imagenes_Evolucion(url_imagen)') 
        .eq('id', id)
        .order('fecha', { ascending: false });

    if (error) {
        console.error("Error en consulta historial:", error);
        return res.status(400).json(error);
    }
    res.json(data || []);
});

// GUARDAR EVOLUCIÓN
app.post('/agregar-evolucion', upload.array('imagenes', 5), async (req, res) => {
    const body = req.body;
    try {
        const { data: nota, error: notaErr } = await supabase
            .from('Evolucion')
            .insert([{
                id: parseInt(body.id),
                fecha: body.fecha,
                escala_dolor: parseInt(body.escala_dolor) || 0,
                nota_evolucion: body.nota_evolucion,
                ejercicios: body.ejercicios,
                hallazgos_eco: body.hallazgos_eco,
                hallazgos_rx: body.hallazgos_rx
            }]).select('id_nota').single();

        if (notaErr) throw notaErr;

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const nombre = `${Date.now()}-${file.originalname}`;
                await supabase.storage.from('imagenes_evolucion').upload(nombre, file.buffer, { contentType: file.mimetype });
                const { data: urlData } = supabase.storage.from('imagenes_evolucion').getPublicUrl(nombre);
                await supabase.from('Imagenes_Evolucion').insert([{ id_nota: nota.id_nota, url_imagen: urlData.publicUrl }]);
            }
        }
        res.json({ mensaje: "Guardado correctamente en FisioCid" });
    } catch (e) { 
        console.error("Error al guardar:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});

// ELIMINAR EVOLUCIÓN
app.delete('/eliminar-evolucion/:id_nota', async (req, res) => {
    const { id_nota } = req.params;
    const { error } = await supabase.from('Evolucion').delete().eq('id_nota', id_nota);
    if (error) return res.status(400).json(error);
    res.json({ mensaje: "Eliminado" });
});

// CONFIGURACIÓN DE PUERTO PARA RENDER (IMPORTANTE)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor FisioCid en línea en puerto ${PORT}`));