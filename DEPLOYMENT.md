# GitHub → Render 빠른 배포 안내

## 1. 업로드할 위치

기존 `biblebattle` 대신 새 저장소 **awana-grand-prix**를 권장합니다.

`F:\awana`의 내용물을 저장소 최상위에 올리세요. GitHub의 첫 화면에 `package.json`, `server.js`, `render.yaml`, `public` 폴더가 보여야 합니다. `awana` 폴더째 한 단계 깊게 업로드했다면 Render Root Directory를 `awana`로 지정해야 합니다. ZIP 파일 자체를 업로드하지 마세요.

`.env`, 실제 경기 데이터와 백업은 업로드하지 않습니다.

## 2. Render 설정

`New → Blueprint`에서 저장소를 연결하면 `render.yaml`을 읽어 Web Service와 영구 디스크를 구성합니다. 진행자용 `HOST_PIN`을 입력하고, 표시된 유료 구성과 비용을 확인한 뒤 배포하세요.

직접 Web Service를 만들 경우:

```text
Runtime: Node
Build Command: npm ci
Start Command: npm start
Health Check Path: /healthz
Instance Count: 1
Auto Deploy: Off (경기 중 재배포 방지)

NODE_VERSION = 24.20.0
NODE_ENV = production
HOST_PIN = 본인이 정한 8자 이상 비밀번호
DATA_DIR = /var/data

Persistent Disk Mount Path = /var/data
Persistent Disk Size = 1 GB
```

**영구 디스크는 유료 서비스에 연결해야 합니다.** Render 기본 파일 시스템은 재시작·재배포 때 변경 사항이 사라집니다. `DATA_DIR`만 설정하고 디스크를 연결하지 않으면 기록 보존이 되지 않습니다. [Render 공식 영구 디스크 설명](https://render.com/docs/disks)

## 3. 두 노트북 연결

| 노트북 | 주소 | 작업 |
| --- | --- | --- |
| 기록용 | `https://서비스주소.onrender.com/host` | 비밀번호 로그인 → 참가 등록 → 경기 운영 |
| TV용 | `https://서비스주소.onrender.com/tv` | TV 연결 → F11/전체 화면 → 응원 화면 |

Render 사용 시 두 노트북 모두 인터넷에 연결되어 있으면 됩니다. TV 화면에는 입력·수정 버튼이 없습니다. 모든 데이터는 Render 서버의 동일한 DB에서 공유합니다.

## 4. 첫 배포 점검

1. `/healthz`에 접속했을 때 `{"ok":true}`가 보이는지 확인.
2. `/host` 로그인 성공, `/tv` 실시간 연결 표시 확인.
3. 본 대회와 다른 데이터 경로에서 테스트 명단으로 한 조 입력 → TV 갱신 확인.
4. 서버 재시작 후 테스트 명단과 기록이 유지되는지 확인.
5. 실제 대회 전에 `DATA_DIR=/var/data/event-main`처럼 새 빈 경로로 변경하여 재배포. 기존 테스트 기록은 별도로 남습니다.
6. 경기 당일에는 Render 수동 재배포, 코드 업로드에 따른 배포, 서비스 재시작을 피하세요.

## 5. DB와 비용

현재 설계는 Node 24 내장 SQLite와 단일 영구 디스크입니다. 별도의 PostgreSQL 요금이나 DB 계정은 필요하지 않습니다. Web Service와 디스크의 실제 요금은 생성 시 Render 화면에서 확인하세요. 이 프로젝트 파일은 GitHub 저장소 생성·업로드, Render 서비스 생성 또는 결제를 자동 수행하지 않습니다.

인터넷 없이 운영하려면 두 노트북을 같은 네트워크에 연결하고 호스트 노트북에서 로컬 서버를 실행하는 방법을 사용하세요. 상세 절차와 백업은 [README](README.md)를 참고하세요.
