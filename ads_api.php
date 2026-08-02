<?php
// Configuración de cabeceras para CORS y no cachear
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type, X-Admin-Password");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Content-Type: application/json; charset=utf-8");

header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");
header("Expires: Sat, 26 Jul 1997 05:00:00 GMT");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$db_file = __DIR__ . '/ads.json';
$admin_password = "4206371Luis*";

// Leer anuncios existentes
function get_ads($file) {
    if (!file_exists($file)) {
        // Intentar leer de mock_ads.json para iniciar con datos si existe, si no, usar array vacío
        $mock_file = __DIR__ . '/mock_ads.json';
        if (file_exists($mock_file)) {
            $data = @file_get_contents($mock_file);
            if ($data !== false) {
                @file_put_contents($file, $data);
                return json_decode($data, true);
            }
        }
        return [];
    }
    $content = @file_get_contents($file);
    $decoded = json_decode($content, true);
    return is_array($decoded) ? $decoded : [];
}

// Guardar anuncios
function save_ads($file, $ads) {
    return @file_put_contents($file, json_encode($ads, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Retornar la lista de anuncios
    $ads = get_ads($db_file);
    echo json_encode($ads);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Validar contraseña de administrador
    $auth_pass = '';
    
    // Intentar leer cabecera X-Admin-Password de varias maneras por portabilidad
    if (function_exists('getallheaders')) {
        $headers = array_change_key_case(getallheaders(), CASE_LOWER);
        if (isset($headers['x-admin-password'])) {
            $auth_pass = $headers['x-admin-password'];
        }
    }
    
    if (empty($auth_pass) && isset($_SERVER['HTTP_X_ADMIN_PASSWORD'])) {
        $auth_pass = $_SERVER['HTTP_X_ADMIN_PASSWORD'];
    }

    // Leer el cuerpo de la petición
    $input = file_get_contents('php://input');
    $body = json_decode($input, true);

    // Permitir contraseña también en el cuerpo por redundancia
    if (empty($auth_pass) && isset($body['password'])) {
        $auth_pass = $body['password'];
    }

    if ($auth_pass !== $admin_password) {
        http_response_code(401);
        echo json_encode(["success" => false, "error" => "No autorizado. Contraseña de administrador inválida."]);
        exit();
    }

    $action = isset($body['action']) ? $body['action'] : '';
    $ads = get_ads($db_file);

    if ($action === 'save') {
        $adData = isset($body['adData']) ? $body['adData'] : null;
        if (!$adData || !isset($adData['id'])) {
            http_response_code(400);
            echo json_encode(["success" => false, "error" => "Datos de anuncio incompletos."]);
            exit();
        }

        $adId = $adData['id'];
        
        // Procesar imagen si viene en formato base64
        $imageUrl = isset($adData['imageUrl']) ? $adData['imageUrl'] : '';
        if (preg_match('/^data:image\/(\w+);base64,/', $imageUrl, $type)) {
            $image_data = substr($imageUrl, strpos($imageUrl, ',') + 1);
            $ext = strtolower($type[1]);
            if (!in_array($ext, ['jpg', 'jpeg', 'gif', 'png', 'webp'])) {
                http_response_code(400);
                echo json_encode(["success" => false, "error" => "Formato de imagen no soportado. Use JPG, PNG, GIF o WEBP."]);
                exit();
            }
            $decoded_image = base64_decode($image_data);
            if ($decoded_image === false) {
                http_response_code(400);
                echo json_encode(["success" => false, "error" => "Decodificación de imagen fallida."]);
                exit();
            }

            // Crear directorio uploads si no existe
            $upload_dir = __DIR__ . '/uploads';
            if (!is_dir($upload_dir)) {
                @mkdir($upload_dir, 0755, true);
            }

            // Nombre de archivo único
            $file_name = 'uploads/ad_' . $adId . '.' . $ext;
            if (@file_put_contents(__DIR__ . '/' . $file_name, $decoded_image) === false) {
                http_response_code(500);
                echo json_encode(["success" => false, "error" => "No se pudo escribir la imagen en el servidor."]);
                exit();
            }

            // Reemplazar la URL base64 por la URL relativa del servidor
            $adData['imageUrl'] = $file_name;
        }

        // Buscar si ya existe el anuncio para actualizarlo, o agregarlo al final
        $found = false;
        foreach ($ads as $idx => $ad) {
            if ($ad['id'] === $adId) {
                // Mantener estado anterior de isActive si no viene definido en la petición
                if (!isset($adData['isActive'])) {
                    $adData['isActive'] = $ad['isActive'];
                }
                // Si no se envió imagen nueva y se conserva la actual, usar la anterior
                if (empty($adData['imageUrl']) && !empty($ad['imageUrl'])) {
                    $adData['imageUrl'] = $ad['imageUrl'];
                }
                $ads[$idx] = $adData;
                $found = true;
                break;
            }
        }

        if (!$found) {
            if (!isset($adData['isActive'])) {
                $adData['isActive'] = true;
            }
            $ads[] = $adData;
        }

        if (save_ads($db_file, $ads)) {
            echo json_encode(["success" => true, "ad" => $adData]);
        } else {
            http_response_code(500);
            echo json_encode(["success" => false, "error" => "Error al guardar el archivo ads.json en el servidor."]);
        }
        exit();

    } elseif ($action === 'delete') {
        $adId = isset($body['adId']) ? $body['adId'] : '';
        if (empty($adId)) {
            http_response_code(400);
            echo json_encode(["success" => false, "error" => "ID de anuncio no especificado."]);
            exit();
        }

        $new_ads = [];
        $deleted = false;
        foreach ($ads as $ad) {
            if ($ad['id'] === $adId) {
                // Eliminar archivo de imagen física si existe y está en uploads
                $imageUrl = $ad['imageUrl'];
                if (!empty($imageUrl) && strpos($imageUrl, 'uploads/') === 0 && file_exists(__DIR__ . '/' . $imageUrl)) {
                    @unlink(__DIR__ . '/' . $imageUrl);
                }
                $deleted = true;
            } else {
                $new_ads[] = $ad;
            }
        }

        if ($deleted) {
            if (save_ads($db_file, $new_ads)) {
                echo json_encode(["success" => true]);
            } else {
                http_response_code(500);
                echo json_encode(["success" => false, "error" => "Error al actualizar ads.json en el servidor."]);
            }
        } else {
            http_response_code(404);
            echo json_encode(["success" => false, "error" => "Anuncio no encontrado."]);
        }
        exit();

    } else {
        http_response_code(400);
        echo json_encode(["success" => false, "error" => "Acción no reconocida."]);
        exit();
    }
}

http_response_code(405);
echo json_encode(["success" => false, "error" => "Método no permitido."]);
