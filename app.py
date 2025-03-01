from flask import Flask, render_template, request, jsonify, session, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import random
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'gizli_anahtar123'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max-limit
app.config['CORS_HEADERS'] = 'Content-Type'

# CORS ayarları
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "allow_headers": "*",
        "expose_headers": "*",
        "methods": ["GET", "POST", "OPTIONS", "HEAD", "DELETE"]
    }
})

# SocketIO ayarları
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    ping_timeout=60,
    ping_interval=25,
    async_mode="threading",  # async_mode'u None olarak değiştirdik
    logger=True,  # Hata ayıklama için logger ekledik
    engineio_logger=True  # Engine.IO logger'ı da ekledik
)

# Oyun odalarını tutacak sözlük
rooms = {}

class GameRoom:
    def __init__(self):
        self.players = []
        self.current_player = None
        self.chamber = random.randint(1, 6)
        self.current_chamber = 1
        self.double_shot_active = False
        self.shots_remaining = 0
        self.shielded_player = None
        self.game_over = False
        self.scores = {}
        self.wheel_spun_players = set()  # Çarkı çeviren oyuncuları takip et
        self.active_jokers = {}  # Her oyuncunun aktif jokerini takip et

    def add_player(self, player_name):
        if player_name not in self.players:
            self.players.append(player_name)
            if player_name not in self.scores:
                self.scores[player_name] = 0

    def update_score(self, winner):
        if winner in self.scores:
            self.scores[winner] += 1

    def reset_round(self):
        self.chamber = random.randint(1, 6)
        self.current_chamber = 1
        self.double_shot_active = False
        self.shots_remaining = 0
        self.shielded_player = None
        self.wheel_spun_players.clear()
        self.active_jokers.clear()

def get_other_player(room, current_player):
    game = rooms[room]
    return next(p for p in game.players if p != current_player)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

@app.route('/reset')
def reset_server():
    global rooms
    rooms = {}
    return 'Server reset successful'

@socketio.on('join_game')
def on_join(data):
    player_name = data['name']
    
    try:
        # Mevcut boş oda var mı kontrol et
        available_room = None
        for room_id, game in rooms.items():
            if len(game.players) < 2 and not game.game_over:
                available_room = room_id
                break
        
        # Boş oda yoksa yeni oda oluştur
        if not available_room:
            room_id = f"room_{len(rooms) + 1}"
            rooms[room_id] = GameRoom()
            available_room = room_id
        
        game = rooms[available_room]
        game.add_player(player_name)
        
        join_room(available_room)
        
        emit('game_joined', {
            'room': available_room,
            'players': game.players,
            'scores': game.scores
        }, room=available_room)
        
        if len(game.players) == 2:
            game.current_player = game.players[0]
            emit('game_status', {
                'message': 'Düello başladı! Çarkı çevirip joker kazanabilirsiniz.',
                'currentPlayer': game.current_player,
                'scores': game.scores,
                'yourTurn': game.current_player == player_name
            }, room=available_room)
    
    except Exception as e:
        emit('error', {'message': str(e)})

@socketio.on('use_joker')
def handle_joker(data):
    room_id = data['room']
    player = data['player']
    joker_type = data['joker_type']
    game = rooms[room_id]
    
    other_player = get_other_player(room_id, player)
    
    if joker_type == 'double':
        game.double_shot_active = True
        game.shots_remaining = 2
        game.current_player = other_player  # Sırayı diğer oyuncuya geç
        
        emit('double_shot_activated', {
            'player': player,
            'next_player': other_player,
            'shots_remaining': 2
        }, room=room_id)
    
    elif joker_type == 'shield':
        game.shielded_player = player
        game.active_jokers[player] = 'shield'
        
        emit('shield_activated', {
            'player': player,
            'message': f'{player} koruma kalkanı aktifleştirdi!'
        }, room=room_id)
    
    elif joker_type == 'skip':
        game.current_player = other_player
        
        emit('turn_skipped', {
            'current_player': player,
            'next_player': other_player,
            'message': f'{player} sırasını pas geçti!'
        }, room=room_id)

@socketio.on('pull_trigger')
def handle_trigger(data):
    room_id = data['room']
    shooter = data['player']
    game = rooms[room_id]
    
    hit = game.current_chamber == game.chamber
    
    if hit:
        if game.shielded_player == shooter:
            # Kalkan aktifse, korunan oyuncu direkt kazanır
            game.game_over = True
            winner = shooter  # Korunan oyuncu kazanır
            game.update_score(winner)
            
            emit('game_over', {
                'winner': winner,
                'loser': get_other_player(room_id, shooter),
                'scores': game.scores,
                'shield_win': True  # Kalkan ile kazanma durumunu belirt
            }, room=room_id)
        else:
            # Normal ölüm
            game.game_over = True
            winner = get_other_player(room_id, shooter)
            game.update_score(winner)
            
            emit('game_over', {
                'winner': winner,
                'loser': shooter,
                'scores': game.scores,
                'shield_win': False
            }, room=room_id)
    else:
        game.current_chamber += 1
        
        if game.double_shot_active:
            game.shots_remaining -= 1
            if game.shots_remaining > 0:
                # Hala atış hakkı var
                emit('trigger_result', {
                    'hit': False,
                    'double_shot_active': True,
                    'shots_remaining': game.shots_remaining,
                    'current_player': shooter
                }, room=room_id)
            else:
                # Çift atış bitti, sıra diğer oyuncuya geçiyor
                game.double_shot_active = False
                game.current_player = get_other_player(room_id, shooter)
                emit('trigger_result', {
                    'hit': False,
                    'double_shot_active': False,
                    'next_player': game.current_player
                }, room=room_id)
        else:
            # Normal atış, sıra diğer oyuncuya geçiyor
            game.current_player = get_other_player(room_id, shooter)
            emit('trigger_result', {
                'hit': False,
                'next_player': game.current_player
            }, room=room_id)

@socketio.on('disconnect')
def handle_disconnect():
    for room_id, game in list(rooms.items()):
        if len(game.players) < 2:
            del rooms[room_id]
            emit('player_disconnected', {
                'message': 'Rakip oyundan ayrıldı!'
            }, to=room_id)

@socketio.on_error_default
def default_error_handler(e):
    print('SocketIO Hatası:', str(e))
    emit('error', {'message': str(e)})

@socketio.on('restart_game')
def on_restart(data):
    room = rooms[data['room']]
    
    room.game_over = False
    room.reset_round()
    
    room.current_player = room.players[0]
    
    emit('game_restarted', {
        'message': 'Yeni oyun başlıyor!',
        'currentPlayer': room.current_player,
        'scores': room.scores,
        'players': room.players
    }, room=data['room'])
    
    emit('game_status', {
        'message': 'Çarkı çevirin ve joker kazanın!',
        'currentPlayer': room.current_player,
        'scores': room.scores,
        'yourTurn': room.current_player == data['player']
    }, room=data['room'])

@socketio.on('wheel_spun')
def handle_wheel_spin(data):
    room_id = data['room']
    player = data['player']
    game = rooms[room_id]
    
    if player not in game.wheel_spun_players:
        game.wheel_spun_players.add(player)
        emit('wheel_spun_by_opponent', {
            'player': player
        }, room=room_id)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(
        app,
        host='0.0.0.0',
        port=port,
        debug=True,
        allow_unsafe_werkzeug=True,
        log_output=True
    )
