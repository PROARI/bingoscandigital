<?php
/**
 * API de Anuncios/Banners para Bingo Scan Digital
 * Permite almacenar, actualizar, activar/desactivar y eliminar anuncios
 * centralizándolos en el hosting usando un archivo JSON de almacenamiento.
 */

// Permitir peticiones CORS para pruebas locales y dominios cruzados
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type, X-Admin-Password");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");

// Manejar petición preflight (CORS)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$file = 'ads.json';

// Si el archivo no existe, crearlo con una lista vacía
if (!file_exists($file)) {
    if (file_put_contents($file, json_encode([])) === false) {
        http_response_code(500);
        echo json_encode(["error" => "No se pudo inicializar el archivo de base de datos de anuncios. Verifique los permisos de escritura del hosting."]);
        exit;
    }
}

// Configurar cabeceras de no-caché para la respuesta HTTP
header("Cache-Control: no-cache, no-store, must-revalidate");
header("Pragma: no-cache");
header("Expires: 0");
header("Content-Type: application/json; charset=utf-8");

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // Retornar los anuncios almacenados
    $content = file_get_contents($file);
    if ($content === false) {
        http_response_code(500);
        echo json_encode(["error" => "No se pudo leer la base de datos de anuncios."]);
        exit;
    }
    echo $content;
    exit;
}

if ($method === 'POST') {
    // Validar contraseña de administrador en la cabecera HTTP
    $adminPassword = isset($_SERVER['HTTP_X_ADMIN_PASSWORD']) ? $_SERVER['HTTP_X_ADMIN_PASSWORD'] : '';
    if ($adminPassword !== '4206371Luis*') {
        http_response_code(401);
        echo json_encode(["error" => "No autorizado. La contraseña es incorrecta o no fue proporcionada."]);
        exit;
    }

    // Leer datos de entrada
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);

    if (!$data || !isset($data['action'])) {
        http_response_code(400);
        echo json_encode(["error" => "Petición inválida. Se requiere una acción."]);
        exit;
    }

    $action = $data['action'];
    $currentAds = json_decode(file_get_contents($file), true);
    if (!is_array($currentAds)) {
        $currentAds = [];
    }

    if ($action === 'save') {
        $newAd = isset($data['ad']) ? $data['ad'] : null;
        if (!$newAd || !isset($newAd['id'])) {
            http_response_code(400);
            echo json_encode(["error" => "Datos de anuncio incompletos o inválidos."]);
            exit;
        }

        // Buscar si existe para actualizarlo, si no agregarlo al final
        $updated = false;
        foreach ($currentAds as $key => $ad) {
            if ($ad['id'] === $newAd['id']) {
                $currentAds[$key] = $newAd;
                $updated = true;
                break;
            }
        }
        if (!$updated) {
            $currentAds[] = $newAd;
        }

        // Guardar cambios en el archivo
        if (file_put_contents($file, json_encode($currentAds, JSON_PRETTY_PRINT)) === false) {
            http_response_code(500);
            echo json_encode(["error" => "Error de escritura en el servidor. Verifique los permisos de ads.json."]);
            exit;
        }

        echo json_encode(["status" => "success", "message" => "Anuncio guardado correctamente."]);
        exit;
    }

    if ($action === 'delete') {
        $adId = isset($data['id']) ? $data['id'] : null;
        if (!$adId) {
            http_response_code(400);
            echo json_encode(["error" => "ID de anuncio no especificado para la eliminación."]);
            exit;
        }

        // Filtrar el anuncio a eliminar
        $filteredAds = array_filter($currentAds, function ($ad) use ($adId) {
            return $ad['id'] !== $adId;
        });
        
        // Reindexar el array antes de codificar a JSON
        $filteredAds = array_values($filteredAds);

        // Guardar cambios
        if (file_put_contents($file, json_encode($filteredAds, JSON_PRETTY_PRINT)) === false) {
            http_response_code(500);
            echo json_encode(["error" => "Error de escritura en el servidor. Verifique los permisos de ads.json."]);
            exit;
        }

        echo json_encode(["status" => "success", "message" => "Anuncio eliminado correctamente."]);
        exit;
    }

    http_response_code(400);
    echo json_encode(["error" => "Acción no soportada: " . htmlspecialchars($action)]);
    exit;
}

http_response_code(405);
echo json_encode(["error" => "Método no permitido: " . htmlspecialchars($method)]);
exit;
