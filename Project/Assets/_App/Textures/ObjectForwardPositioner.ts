import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"

@component
export class ObjectForwardPositioner extends BaseScriptComponent {
    
    @input private readonly additiveVectorPosition: vec3;
    
    // private worldCamera: WorldCameraFinderProvider

    protected cameraTransform: Transform =
        WorldCameraFinderProvider.getInstance().getTransform();

    constructor()
    {
        super();
        // this.worldCamera = WorldCameraFinderProvider.getInstance();
        this.createEvent("OnStartEvent").bind(() => this.onStart());
        this.createEvent("OnEnableEvent").bind(this.onEnable.bind(this));
    }

    onStart() 
    {
        this.positionInFrontOfUser();
    }

    onEnable()
    {
        this.positionInFrontOfUser();
    }

    private positionInFrontOfUser() 
    {

        var worldCameraForward = this.cameraTransform.right
        .cross(vec3.up())
        .normalize();

        print("Camera forward =" + worldCameraForward);


        // var camComp = this.cameraTransform.getSceneObject().getComponent("Camera");

        // // const head = this.worldCamera.getTransform().getWorldPosition();
        
        // const forward = this.cameraTransform.forward;
        // const right = this.cameraTransform.right;
        // const up = this.cameraTransform.up;

        // const normalizedX = right.normalize().uniformScale(-this.additiveVectorPosition.x).x;
        // const normalizedY = up.normalize().uniformScale(this.additiveVectorPosition.y).y;
        // const normalizedZ = forward.normalize().uniformScale(-this.additiveVectorPosition.z).z;

        // var position = new vec3(normalizedX, normalizedY, normalizedZ);
        
        // forward.y = 0
        
        var forwardMultiplication = worldCameraForward.mult(this.additiveVectorPosition);
        var additiveToWorldPosition = this.cameraTransform.getWorldPosition().add(forwardMultiplication);
        this.getTransform().setWorldPosition(additiveToWorldPosition);

        print("Dest position =" + forwardMultiplication);

    }
}
